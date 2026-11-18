import { eq } from 'drizzle-orm'
import { paiements } from '../../../shared/db/schema'
import { PAIEMENT_SOURCE_FOURNISSEUR } from '../../../shared/paiements'
import type { ConfirmationResultat } from '../../../shared/admin-paiements'
import { NotFoundError } from '../../exceptions/http'
import { insertTransactionalEmailEvents } from '../email-outbox'
import type { DbTransaction } from '../email-outbox'
import { prolonger } from './prolongation'
import type { ResultatProlongation } from './prolongation'

// A3 (docs/specs/A3-abonnements-paiements.md §4) : service UNIQUE de confirmation d'un paiement. Le webhook, le
// rapprochement du worker, la revérification admin et le marquage manuel passent TOUS par ici : un seul endroit
// prolonge l'abonnement, un seul endroit pose `reussi`. Idempotent : un paiement déjà `reussi` n'est jamais
// reprolongé (garantie par le verrou `FOR UPDATE` du paiement, PAS par l'appelant).

/** Identifiants et frais connus du fournisseur au moment de la confirmation (jamais écrasés s'ils existent déjà). */
export interface ComplementsConfirmation {
  idFournisseur?: string | null
  referenceFournisseur?: string | null
  fraisReels?: number | null
  netReel?: number | null
}

const MOTIF_UTILISATEUR_SUPPRIME = 'UTILISATEUR_SUPPRIME'
/** Plus grand entier d'une colonne `integer` PostgreSQL. */
const ENTIER_MAX = 2_147_483_647

/** Frais ou net du fournisseur : entier sûr entre 0 et `ENTIER_MAX`, sinon ignoré (une valeur aberrante ne doit JAMAIS faire échouer un encaissement). */
function entierOuNull(valeur: number | null | undefined): number | null {
  return typeof valeur === 'number' && Number.isSafeInteger(valeur) && valeur >= 0 && valeur <= ENTIER_MAX ? valeur : null
}

/**
 * Confirme un paiement DANS la transaction de l'appelant. Ordre des verrous : paiement, puis utilisateur (verrou
 * consultatif de `prolonger`). Une panne se propage : l'appelant annule toute la transaction.
 *  - `reussi` : `deja_applique`, aucune écriture.
 *  - `anomalie` (état final) : `refuse_anomalie`, aucune écriture.
 *  - sinon : prolongation, passage à `reussi`, reçu (paiement K-PAY seulement), `applique`.
 */
export async function confirmerPaiement(
  tx: DbTransaction,
  paiementId: string,
  now: Date,
  complements: ComplementsConfirmation = {},
): Promise<ConfirmationResultat> {
  const [paiement] = await tx.select().from(paiements).where(eq(paiements.id, paiementId)).for('update')
  if (paiement === undefined) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  if (paiement.statut === 'reussi') return 'deja_applique'
  if (paiement.statut === 'anomalie') return 'refuse_anomalie'

  let prolongation: ResultatProlongation | null = null
  // Compte supprimé entre-temps : l'argent est pris mais il n'y a plus d'abonnement à prolonger. Le paiement reste
  // une pièce comptable `reussi`, sans effet ni reçu (cas marginal, signalé dans les journaux).
  if (paiement.userId !== null) {
    prolongation = await prolonger(tx, paiement.userId, paiement.periodeMois, now, paiement.id)
  } else {
    console.error({ paiement: 'sans_utilisateur', id: paiement.id, motif: MOTIF_UTILISATEUR_SUPPRIME })
  }
  await tx
    .update(paiements)
    .set({
      idFournisseur: paiement.idFournisseur ?? complements.idFournisseur ?? null,
      referenceFournisseur: paiement.referenceFournisseur ?? complements.referenceFournisseur ?? null,
      statut: 'reussi',
      codeEchec: null,
      appliqueLe: now,
      termineLe: now,
      prochaineVerification: null,
      fraisReels: entierOuNull(complements.fraisReels) ?? paiement.fraisReels,
      netReel: entierOuNull(complements.netReel) ?? paiement.netReel,
      abonnementExpireAvant: prolongation?.avant ?? null,
      abonnementExpireApres: prolongation?.apres ?? null,
      updatedAt: now,
    })
    .where(eq(paiements.id, paiement.id))
  // Reçu dans la MÊME transaction : jamais d'activation sans reçu planifié, jamais de reçu sans activation. La clé
  // d'unicité (entité, type, occurrence vide) l'empêche d'être planifié deux fois. Pas de reçu pour un paiement
  // manuel (D-A3-03, ⚠️ R7) : l'administrateur n'est pas le fournisseur.
  if (paiement.userId !== null && paiement.source === PAIEMENT_SOURCE_FOURNISSEUR) {
    await insertTransactionalEmailEvents(tx, 'paiement', paiement.id, ['paiement_confirme'], now)
  }
  return 'applique'
}
