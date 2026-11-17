// A3 (D-A3-04) : revérification d'un paiement auprès du fournisseur par l'administrateur. `consulter` puis
// `appliquerEvenement` : le MÊME chemin que le webhook et le worker (donc `confirmerPaiement`, jamais une écriture
// parallèle). Consomme le budget K-PAY partagé (503 `FOURNISSEUR_INDISPONIBLE` s'il est épuisé, sans jamais bloquer
// le webhook) et une limite par administrateur. Idempotente par clé : un rejeu relit le journal, sans rappeler K-PAY.
import { eq } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import type { ReverificationResultat } from '../../../shared/admin-paiements'
import { paiements } from '../../../shared/db/schema'
import { ADMIN_REVERIFICATION_CLE_PREFIXE, ADMIN_REVERIFICATION_LIMIT } from '../../../shared/limites'
import type { FournisseurPaiement, PaiementStatut } from '../../../shared/paiements'
import { PAIEMENT_STATUTS } from '../../../shared/paiements'
import { schemaReverificationReponse } from '../../../shared/schemas/admin-paiements'
import type { ActionPaiement, ReverificationReponse } from '../../../shared/schemas/admin-paiements'
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { readPgError, PG_UNIQUE_VIOLATION } from '../../utils/pg-error'
import { enforceLimit } from '../limiteur'
import { appliquerEvenement } from '../paiements/application'
import { reserverAppelFournisseur } from '../paiements/budget'
import { estFournisseurConnu, getPaiementProvider } from '../paiements/fournisseurs'
import { FournisseurIndisponibleError } from '../paiements/types'
import type { EtatFournisseur, EvenementNormalise, PaiementProvider } from '../paiements/types'
import { enregistrer } from './audit'
import { lireRejeu, RESULTAT_NON_REUSSI } from './paiements-journal'
import type { ActeurAdmin } from './paiements-journal'

export interface ReverificationDeps {
  getProvider?: (nom: FournisseurPaiement) => PaiementProvider | null
  reserverAppel?: (nom: FournisseurPaiement) => Promise<void>
  now?: Date
}

const NOM_EVENEMENT: Record<'reussi' | 'echoue' | 'annule', string> = {
  reussi: 'payment.completed',
  echoue: 'payment.failed',
  annule: 'payment.cancelled',
}

function statutConnu(valeur: string): PaiementStatut | undefined {
  return PAIEMENT_STATUTS.find((statut) => statut === valeur)
}

function versEvenement(etat: EtatFournisseur, paiementId: string, statut: 'reussi' | 'echoue' | 'annule'): EvenementNormalise {
  return {
    evenement: NOM_EVENEMENT[statut],
    idTransaction: etat.idFournisseur,
    externalId: paiementId,
    statut,
    montant: etat.montant,
    devise: etat.devise,
    referenceFournisseur: etat.referenceFournisseur,
    horodatage: null,
    codeEchec: etat.codeEchec,
    statutBrut: etat.statutBrut ?? null,
    fraisReels: etat.fraisReels,
    netReel: etat.netReel,
  }
}

async function lireStatut(paiementId: string): Promise<PaiementStatut> {
  const [ligne] = await db.select({ statut: paiements.statut }).from(paiements).where(eq(paiements.id, paiementId))
  const statut = ligne === undefined ? undefined : statutConnu(ligne.statut)
  if (statut === undefined) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  return statut
}

/** Applique ce que dit le fournisseur et conclut. Un état non concluant (en attente, remboursé) ne permet JAMAIS le marquage manuel. */
async function appliquerEtat(
  paiementId: string,
  fournisseur: FournisseurPaiement,
  provider: PaiementProvider,
  etat: EtatFournisseur,
  now: Date,
): Promise<ReverificationResultat> {
  if (etat.externalId && etat.externalId !== paiementId) {
    console.error({ paiement: 'external_id_incoherent', id: paiementId })
    return 'en_attente'
  }
  if (etat.statut === 'en_attente' || etat.statut === 'rembourse') return 'en_attente'

  const application = await appliquerEvenement(
    fournisseur,
    versEvenement(etat, paiementId, etat.statut),
    'interrogation',
    now,
    { environnement: provider.environnement },
  )
  if (etat.statut !== 'reussi') return RESULTAT_NON_REUSSI
  const statut = await lireStatut(paiementId)
  if (statut === 'anomalie') return 'refuse_anomalie'
  if (statut !== 'reussi') return 'en_attente'
  return application.traitement === 'applique' ? 'applique' : 'deja_applique'
}

function reponseRejouee(apres: Record<string, unknown>): ReverificationReponse {
  return schemaReverificationReponse.parse({ resultat: apres.resultat, statut: apres.statut, rejoue: true })
}

async function journaliser(acteur: ActeurAdmin, paiementId: string, entree: ActionPaiement, resultat: ReverificationResultat, statut: PaiementStatut): Promise<void> {
  await db.transaction((tx) => enregistrer(tx, {
    adminId: acteur.adminId,
    action: ADMIN_ACTIONS.paiementReverifier,
    cibleType: ADMIN_CIBLES.paiement,
    cibleId: paiementId,
    avant: null,
    apres: { resultat, statut },
    motif: entree.motif,
    ip: acteur.ip,
    cleIdempotence: entree.cleIdempotence,
  }))
}

/**
 * Revérifie un paiement. Un paiement déjà `reussi` est quand même interrogé (budget et limite consommés) : `deja_applique`.
 * Un paiement sans identifiant fournisseur (initiation incertaine) ne peut pas être interrogé : 409.
 */
export async function reverifierPaiement(
  acteur: ActeurAdmin,
  paiementId: string,
  entree: ActionPaiement,
  deps: ReverificationDeps = {},
): Promise<ReverificationReponse> {
  const rejeu = await lireRejeu(db, acteur.adminId, entree.cleIdempotence, ADMIN_ACTIONS.paiementReverifier, paiementId)
  if (rejeu !== null) return reponseRejouee(rejeu.apres)

  // Limite par administrateur appliquée à TOUTE revérification neuve (le rejeu, lu avant, ne consomme rien).
  await enforceLimit(
    `${ADMIN_REVERIFICATION_CLE_PREFIXE}${acteur.adminId}`,
    ADMIN_REVERIFICATION_LIMIT.limit,
    ADMIN_REVERIFICATION_LIMIT.windowS,
    { failClosed: true },
  )

  const [paiement] = await db
    .select({
      id: paiements.id,
      fournisseur: paiements.fournisseur,
      idFournisseur: paiements.idFournisseur,
      statut: paiements.statut,
    })
    .from(paiements)
    .where(eq(paiements.id, paiementId))
  if (paiement === undefined) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  const statut = statutConnu(paiement.statut)
  if (statut === undefined) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  const fournisseur = paiement.fournisseur
  if (!estFournisseurConnu(fournisseur)) throw new ConflictError('PAIEMENT_NON_ELIGIBLE')

  let resultat: ReverificationResultat
  if (paiement.idFournisseur === null) {
    // Sans identifiant du fournisseur (initiation incertaine), rien à interroger : seul un paiement déjà confirmé a une réponse.
    if (statut !== 'reussi') throw new ConflictError('PAIEMENT_NON_ELIGIBLE')
    resultat = 'deja_applique'
  } else {
    const provider = (deps.getProvider ?? getPaiementProvider)(fournisseur)
    if (provider === null) throw new ServiceUnavailableError('FOURNISSEUR_INDISPONIBLE')
    await (deps.reserverAppel ?? reserverAppelFournisseur)(fournisseur)
    let etat: EtatFournisseur | null
    try {
      etat = await provider.consulter(paiement.idFournisseur, new AbortController().signal)
    } catch (erreur) {
      if (erreur instanceof FournisseurIndisponibleError) throw new ServiceUnavailableError('FOURNISSEUR_INDISPONIBLE')
      throw erreur
    }
    // Transaction inconnue du fournisseur (404) : il n'a rien encaissé pour cet identifiant.
    resultat = etat === null
      ? RESULTAT_NON_REUSSI
      : await appliquerEtat(paiement.id, fournisseur, provider, etat, deps.now ?? new Date())
  }

  const statutFinal = await lireStatut(paiement.id)
  try {
    await journaliser(acteur, paiement.id, entree, resultat, statutFinal)
  } catch (erreur) {
    // Deux appels simultanés avec la même clé : le second perd sur l'unicité (administrateur, clé) et renvoie le résultat du premier.
    if (readPgError(erreur).code !== PG_UNIQUE_VIOLATION) throw erreur
    const premier = await lireRejeu(db, acteur.adminId, entree.cleIdempotence, ADMIN_ACTIONS.paiementReverifier, paiement.id)
    if (premier === null) throw erreur
    return reponseRejouee(premier.apres)
  }
  return schemaReverificationReponse.parse({ resultat, statut: statutFinal, rejoue: false })
}
