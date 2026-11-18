// A3 (D-A3-03, spec §4) : marquage MANUEL d'un paiement comme payé. Ce n'est pas la correction d'un paiement : c'est la
// CRÉATION d'un encaissement (`source = 'manuel'`) qui remplace un paiement non abouti. UNE transaction :
//   verrou de l'original -> rejeu éventuel -> conditions -> réauthentification -> original en `anomalie` (final, donc un
//   encaissement K-PAY tardif sera journalisé `ignore`/`STATUT_FINAL` sans prolonger) -> insertion du paiement manuel ->
//   `confirmerPaiement` (le service UNIQUE) -> journal.
// Aucun reçu e-mail pour un paiement manuel (⚠️ R7). Le numéro du payeur n'existe pas dans un paiement manuel.
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import {
  CODE_ANOMALIE_REMPLACE_PAR_MANUEL,
  PAIEMENT_FOURNISSEUR_MANUEL,
  PAIEMENT_METHODE_MANUEL,
  PAIEMENT_REFERENCE_MANUEL_PREFIXE,
  PAIEMENT_SOURCE_MANUEL,
  PAIEMENT_STATUTS_REMPLACABLES,
} from '../../../shared/admin-paiements'
import { paiements } from '../../../shared/db/schema'
import { ADMIN_REVERIFICATION_VALIDITE_MIN } from '../../../shared/limites'
import { PAIEMENT_SOURCE_FOURNISSEUR, PAIEMENT_STATUTS_OUVERTS } from '../../../shared/paiements'
import { schemaMarquagePaiementReponse } from '../../../shared/schemas/admin-paiements'
import type { ActionPaiement } from '../../../shared/schemas/admin-paiements'
import { MS_PAR_MINUTE } from '../../../shared/temps'
import { ConflictError, NotFoundError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { enregistrer } from '../admin/audit'
import type { TransactionAdmin } from '../admin/audit'
import { derniereReverificationNonReussie, lireRejeu } from '../admin/paiements-journal'
import type { ActeurAdmin } from '../admin/paiements-journal'
import { confirmerPaiement } from './confirmation'

/** Fraction du montant à la charge du commerçant : un paiement manuel n'a aucun frais (CHECK), le champ reste valide. */
const FRAIS_SUPPORTEUR_MANUEL = 'marchand'
/** Pas de rejeu sans ces deux champs : une ligne de journal malformée est une erreur, jamais un succès inventé. */
const CLE_PAIEMENT_MANUEL = 'paiement_manuel_id'
const CLE_EXPIRE_LE = 'expire_le'

export interface ResultatMarquage {
  /** Identifiant du paiement MANUEL créé (pas celui de l'original). */
  paiementId: string
  /** Nouvelle échéance de l'abonnement. */
  expireLe: Date
  rejoue: boolean
}

/** Appelé DANS la transaction, après les conditions : consomme le code de réauthentification (`exigerReauth`). */
export type ExigerReauth = (tx: TransactionAdmin) => Promise<void>

function reponseRejouee(apres: Record<string, unknown>): ResultatMarquage {
  const lue = schemaMarquagePaiementReponse.parse({
    paiementId: apres[CLE_PAIEMENT_MANUEL],
    expireLe: apres[CLE_EXPIRE_LE],
    rejoue: true,
  })
  return { paiementId: lue.paiementId, expireLe: new Date(lue.expireLe), rejoue: true }
}

export async function marquerPayeManuellement(
  acteur: ActeurAdmin,
  paiementId: string,
  entree: ActionPaiement,
  exigerReauth: ExigerReauth,
  now: Date = new Date(),
): Promise<ResultatMarquage> {
  return db.transaction(async (tx): Promise<ResultatMarquage> => {
    const [original] = await tx.select().from(paiements).where(eq(paiements.id, paiementId)).for('update')
    if (original === undefined) throw new NotFoundError('PAIEMENT_INTROUVABLE')

    // Rejeu : lu APRÈS le verrou de l'original, donc un appel simultané de même clé attend le premier puis le relit.
    const rejeu = await lireRejeu(tx, acteur.adminId, entree.cleIdempotence, ADMIN_ACTIONS.paiementMarquerPaye, paiementId)
    if (rejeu !== null) return reponseRejouee(rejeu.apres)

    if (original.source !== PAIEMENT_SOURCE_FOURNISSEUR) throw new ConflictError('PAIEMENT_NON_ELIGIBLE')
    // Déjà remplacé par un marquage manuel (clé différente) : jamais un second encaissement pour le même paiement.
    if (original.codeEchec === CODE_ANOMALIE_REMPLACE_PAR_MANUEL) throw new ConflictError('PAIEMENT_NON_ELIGIBLE')
    if (original.statut === 'reussi') throw new ConflictError('DEJA_PAYE')
    if ((PAIEMENT_STATUTS_OUVERTS as readonly string[]).includes(original.statut)) throw new ConflictError('PAIEMENT_OUVERT')
    if (!(PAIEMENT_STATUTS_REMPLACABLES as readonly string[]).includes(original.statut) || original.userId === null) {
      throw new ConflictError('PAIEMENT_NON_ELIGIBLE')
    }
    const [ouvert] = await tx
      .select({ id: paiements.id })
      .from(paiements)
      .where(and(eq(paiements.userId, original.userId), inArray(paiements.statut, [...PAIEMENT_STATUTS_OUVERTS])))
      .limit(1)
    if (ouvert !== undefined) throw new ConflictError('PAIEMENT_OUVERT')

    // Le fournisseur a peut-être encaissé : sans identifiant connu ou en cas d'initiation incertaine, une revérification
    // RÉCENTE doit avoir conclu « non réussi ».
    if (original.idFournisseur !== null || original.initiationIncertaine) {
      const depuis = new Date(now.getTime() - ADMIN_REVERIFICATION_VALIDITE_MIN * MS_PAR_MINUTE)
      if (await derniereReverificationNonReussie(tx, original.id, depuis) === null) throw new ConflictError('REVERIFICATION_REQUISE')
    }

    await exigerReauth(tx)

    await tx
      .update(paiements)
      .set({
        statut: 'anomalie',
        codeEchec: CODE_ANOMALIE_REMPLACE_PAR_MANUEL,
        termineLe: original.termineLe ?? now,
        prochaineVerification: null,
        updatedAt: now,
      })
      .where(eq(paiements.id, original.id))

    // Montant = celui du paiement d'origine (le prix vu par le client), jamais la grille du moment.
    const manuelId = randomUUID()
    await tx.insert(paiements).values({
      id: manuelId,
      userId: original.userId,
      fournisseur: PAIEMENT_FOURNISSEUR_MANUEL,
      methode: PAIEMENT_METHODE_MANUEL,
      operateur: null,
      environnement: original.environnement,
      idFournisseur: null,
      referenceFournisseur: `${PAIEMENT_REFERENCE_MANUEL_PREFIXE}${manuelId}`,
      statut: 'cree',
      plan: original.plan,
      periodeMois: original.periodeMois,
      devise: original.devise,
      montantPlan: original.montantPlan,
      montant: original.montant,
      fraisTauxPb: 0,
      fraisSupporteur: FRAIS_SUPPORTEUR_MANUEL,
      fraisEstimes: 0,
      netEstime: original.montant,
      initiationIncertaine: false,
      expireAvant: now,
      source: PAIEMENT_SOURCE_MANUEL,
      createdAt: now,
      updatedAt: now,
    })
    const confirmation = await confirmerPaiement(tx, manuelId, now)
    const [manuel] = await tx.select({ expireLe: paiements.abonnementExpireApres }).from(paiements).where(eq(paiements.id, manuelId))
    if (confirmation !== 'applique' || manuel?.expireLe == null) throw new Error('MARQUAGE_MANUEL_NON_APPLIQUE')

    await enregistrer(tx, {
      adminId: acteur.adminId,
      action: ADMIN_ACTIONS.paiementMarquerPaye,
      cibleType: ADMIN_CIBLES.paiement,
      cibleId: original.id,
      avant: { statut: original.statut },
      apres: {
        [CLE_PAIEMENT_MANUEL]: manuelId,
        [CLE_EXPIRE_LE]: manuel.expireLe.toISOString(),
        montant: original.montant,
        devise: original.devise,
      },
      motif: entree.motif,
      ip: acteur.ip,
      cleIdempotence: entree.cleIdempotence,
    })
    return { paiementId: manuelId, expireLe: manuel.expireLe, rejoue: false }
  })
}
