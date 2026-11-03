import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { paiements } from '../../../shared/db/schema'
import {
  PAIEMENTS_VERIFICATION_CALENDRIER_S,
  PAIEMENTS_VERIFICATION_LOT,
} from '../../../shared/jobs'
import {
  CODE_ECHEC_EXPIRE,
  PAIEMENT_STATUTS_OUVERTS,
} from '../../../shared/paiements'
import type { FournisseurPaiement } from '../../../shared/paiements'
import { ServiceUnavailableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { reserverAppelFournisseur } from './budget'
import { estFournisseurConnu, getPaiementProvider } from './fournisseurs'
import { appliquerEvenement } from './application'
import type { EtatFournisseur, EvenementNormalise, PaiementProvider } from './types'

// S10 (docs/specs/S10-abonnements.md §1 #109, #110, #111) : rapprochement par interrogation. Le webhook signé
// fait autorité ; ceci est un RATTRAPAGE exécuté par le worker (jamais par le navigateur), borné par un lot et par
// le budget global d'appels du fournisseur. Journal : nombres et codes seulement.

const MS_PAR_SECONDE = 1_000
const VERIFICATIONS_MAX = 1_000

export interface RapprochementDeps {
  getProvider?: (nom: FournisseurPaiement) => PaiementProvider | null
  reserverAppel?: (nom: FournisseurPaiement) => Promise<void>
  lot?: number
}

export interface ResultatVerification {
  expires: number
  reclames: number
  interroges: number
  appliques: number
  erreurs: number
}

const NOM_EVENEMENT: Record<Exclude<EtatFournisseur['statut'], 'en_attente'>, string> = {
  reussi: 'payment.completed',
  echoue: 'payment.failed',
  annule: 'payment.cancelled',
  rembourse: 'payment.refunded',
}

/** Expiration locale : au-delà de `expire_avant`, un paiement ouvert passe à `expire` (un `completed` tardif reste appliqué). */
export async function expirerPaiements(now: Date): Promise<number> {
  const expires = await db
    .update(paiements)
    .set({ statut: 'expire', codeEchec: CODE_ECHEC_EXPIRE, termineLe: now, prochaineVerification: null, updatedAt: now })
    .where(and(inArray(paiements.statut, [...PAIEMENT_STATUTS_OUVERTS]), lte(paiements.expireAvant, now)))
    .returning({ id: paiements.id })
  return expires.length
}

interface PaiementReclame {
  id: string
  fournisseur: string
  idFournisseur: string
}

/**
 * Réclame les paiements dus (`FOR UPDATE SKIP LOCKED` : deux ticks ne prennent jamais le même) et avance leur
 * prochaine vérification selon le calendrier (le dernier pas se répète). Un paiement sans identifiant du
 * fournisseur (initiation incertaine) n'est jamais interrogé.
 */
async function reclamer(now: Date, lot: number): Promise<PaiementReclame[]> {
  return db.transaction(async (tx) => {
    const dus = await tx
      .select({
        id: paiements.id,
        fournisseur: paiements.fournisseur,
        idFournisseur: paiements.idFournisseur,
        verifications: paiements.verifications,
      })
      .from(paiements)
      .where(and(
        inArray(paiements.statut, [...PAIEMENT_STATUTS_OUVERTS]),
        isNotNull(paiements.idFournisseur),
        lte(paiements.prochaineVerification, now),
      ))
      .orderBy(asc(paiements.prochaineVerification))
      .limit(lot)
      .for('update', { skipLocked: true })
    const reclames: PaiementReclame[] = []
    for (const ligne of dus) {
      if (ligne.idFournisseur === null) continue
      const pas = Math.min(ligne.verifications, PAIEMENTS_VERIFICATION_CALENDRIER_S.length - 1)
      const delaiS = PAIEMENTS_VERIFICATION_CALENDRIER_S[pas] ?? PAIEMENTS_VERIFICATION_CALENDRIER_S[0]
      await tx
        .update(paiements)
        .set({
          verifications: Math.min(ligne.verifications + 1, VERIFICATIONS_MAX),
          prochaineVerification: new Date(now.getTime() + delaiS * MS_PAR_SECONDE),
          updatedAt: now,
        })
        .where(eq(paiements.id, ligne.id))
      reclames.push({ id: ligne.id, fournisseur: ligne.fournisseur, idFournisseur: ligne.idFournisseur })
    }
    return reclames
  })
}

function versEvenement(etat: EtatFournisseur, paiementId: string, statut: Exclude<EtatFournisseur['statut'], 'en_attente'>): EvenementNormalise {
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
    fraisReels: etat.fraisReels,
    netReel: etat.netReel,
  }
}

/** Un tick du rapprochement : expiration locale, puis interrogation d'au plus `lot` paiements dus. */
export async function verifierPaiementsDus(now: Date, deps: RapprochementDeps = {}): Promise<ResultatVerification> {
  const resultat: ResultatVerification = { expires: 0, reclames: 0, interroges: 0, appliques: 0, erreurs: 0 }
  resultat.expires = await expirerPaiements(now)

  const reclames = await reclamer(now, deps.lot ?? PAIEMENTS_VERIFICATION_LOT)
  resultat.reclames = reclames.length
  const reserver = deps.reserverAppel ?? reserverAppelFournisseur
  const cherche = deps.getProvider ?? getPaiementProvider

  // Le budget se réserve en série (arrêt dès qu'il est épuisé), les consultations partent ensuite en parallèle
  // pour que le tick reste borné par UN délai de consultation.
  const aInterroger: { ligne: PaiementReclame, provider: PaiementProvider }[] = []
  for (const ligne of reclames) {
    if (!estFournisseurConnu(ligne.fournisseur)) { resultat.erreurs++; continue }
    const provider = cherche(ligne.fournisseur)
    if (!provider) { resultat.erreurs++; continue }
    try {
      await reserver(ligne.fournisseur)
    } catch (erreur) {
      if (erreur instanceof ServiceUnavailableError) break
      throw erreur
    }
    aInterroger.push({ ligne, provider })
  }

  await Promise.all(aInterroger.map(async ({ ligne, provider }) => {
    try {
      const etat = await provider.consulter(ligne.idFournisseur, new AbortController().signal)
      resultat.interroges++
      if (etat === null) {
        console.warn({ paiement: 'introuvable_chez_le_fournisseur', id: ligne.id })
        return
      }
      if (etat.externalId && etat.externalId !== ligne.id) {
        console.error({ paiement: 'external_id_incoherent', id: ligne.id })
        resultat.erreurs++
        return
      }
      if (etat.statut === 'en_attente') return
      const applique = await appliquerEvenement(
        ligne.fournisseur,
        versEvenement(etat, ligne.id, etat.statut),
        'interrogation',
        now,
        { environnement: provider.environnement },
      )
      if (applique.traitement === 'applique') resultat.appliques++
    } catch (erreur) {
      resultat.erreurs++
      console.error({ paiement: 'verification_echouee', id: ligne.id, nom: erreur instanceof Error ? erreur.name : typeof erreur })
    }
  }))
  return resultat
}
