import {
  RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  RAPPEL_VISITEUR_AVANCE_HEURES,
  RAPPEL_VISITEUR_PREAVIS_MIN_HEURES,
  RAPPEL_VISITEUR_RATTRAPAGE_HEURES,
  RESUME_RATTRAPAGE_HEURES,
} from '../../../shared/notifications'
import type { CodeAnnulation } from '../../../shared/notifications'

// S9 (docs/specs/S9-notifications.md #83, #102, §4.4) : revalidation PURE d'une ligne d'outbox juste
// avant l'envoi. Les faits (réservation, préférences, vitrine publiée, nombre de rendez-vous du jour,
// destinataire) sont chargés par l'appelant (email-outbox.ts) ; ici on ne fait que décider.
// Renvoie le code d'annulation, ou `null` si l'e-mail peut partir. L'ordre des contrôles est l'ordre
// de priorité des codes de la spec.

const HEURE_MS = 3_600_000

interface EntreeBase {
  /** Clé d'occurrence de la ligne d'outbox. */
  occurrence: string
  /** Date de création de la ligne : référence du rattrapage des e-mails du professionnel. */
  createdAt: Date
}

export interface EntreeRappelVisiteur extends EntreeBase {
  type: 'reservation_visiteur_rappel'
  /** `null` : réservation introuvable. `statut` est celui de la base (chaîne). */
  reservation: { statut: string, rappelEmail: boolean, debut: Date } | null
}

export interface EntreeResumeHebdo extends EntreeBase {
  type: 'utilisateur_resume_hebdo'
  /** `null` : compte introuvable. `destinataire` : une adresse d'envoi existe. */
  utilisateur: { emailHebdo: boolean, vitrinePubliee: boolean, destinataire: boolean } | null
}

export interface EntreeRappelJournee extends EntreeBase {
  type: 'utilisateur_rappel_journee'
  utilisateur: { emailRappelJour: boolean, destinataire: boolean, rendezVousDansJournee: number } | null
}

/** Types historiques (S7) : jamais annulés par la revalidation (pas de régression, #102). */
export interface EntreeHistorique extends EntreeBase {
  type: string
}

export type EntreePertinence = EntreeRappelVisiteur | EntreeResumeHebdo | EntreeRappelJournee | EntreeHistorique

/** Paramètres réglables ; les valeurs par défaut viennent de shared/notifications.ts. */
export interface ReglagesPertinence {
  rappelAvanceHeures: number
  rappelRattrapageHeures: number
  /** Garde défensive : inatteignable avec les valeurs par défaut (le rattrapage de 6 h la couvre). */
  rappelPreavisMinHeures: number
  resumeRattrapageHeures: number
  journeeRattrapageHeures: number
}

export const REGLAGES_PERTINENCE_DEFAUT: ReglagesPertinence = {
  rappelAvanceHeures: RAPPEL_VISITEUR_AVANCE_HEURES,
  rappelRattrapageHeures: RAPPEL_VISITEUR_RATTRAPAGE_HEURES,
  rappelPreavisMinHeures: RAPPEL_VISITEUR_PREAVIS_MIN_HEURES,
  resumeRattrapageHeures: RESUME_RATTRAPAGE_HEURES,
  journeeRattrapageHeures: RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
}

function estRappelVisiteur(entree: EntreePertinence): entree is EntreeRappelVisiteur {
  return entree.type === 'reservation_visiteur_rappel'
}

function estResumeHebdo(entree: EntreePertinence): entree is EntreeResumeHebdo {
  return entree.type === 'utilisateur_resume_hebdo'
}

function estRappelJournee(entree: EntreePertinence): entree is EntreeRappelJournee {
  return entree.type === 'utilisateur_rappel_journee'
}

function apresRattrapage(creeLe: Date, now: Date, heures: number): boolean {
  return now.getTime() > creeLe.getTime() + heures * HEURE_MS
}

function pertinenceRappelVisiteur(entree: EntreeRappelVisiteur, now: Date, reglages: ReglagesPertinence): CodeAnnulation | null {
  const { reservation } = entree
  if (reservation === null) return 'ENTITE_INTROUVABLE'
  if (reservation.statut !== 'confirmee') return 'RESERVATION_NON_CONFIRMEE'
  if (!reservation.rappelEmail) return 'PREFERENCE_DESACTIVEE'
  // Rendez-vous déplacé : la ligne a été planifiée pour un autre début.
  if (reservation.debut.toISOString() !== entree.occurrence) return 'RAPPEL_PERIME'
  const debut = reservation.debut.getTime()
  const prevu = debut - reglages.rappelAvanceHeures * HEURE_MS
  if (now.getTime() > prevu + reglages.rappelRattrapageHeures * HEURE_MS) return 'RAPPEL_PERIME'
  if (now.getTime() > debut - reglages.rappelPreavisMinHeures * HEURE_MS) return 'RAPPEL_PERIME'
  return null
}

function pertinenceResumeHebdo(entree: EntreeResumeHebdo, now: Date, reglages: ReglagesPertinence): CodeAnnulation | null {
  const { utilisateur } = entree
  if (utilisateur === null) return 'ENTITE_INTROUVABLE'
  if (!utilisateur.emailHebdo) return 'PREFERENCE_DESACTIVEE'
  if (!utilisateur.vitrinePubliee) return 'VITRINE_NON_PUBLIEE'
  if (apresRattrapage(entree.createdAt, now, reglages.resumeRattrapageHeures)) return 'RAPPEL_PERIME'
  if (!utilisateur.destinataire) return 'DESTINATAIRE_ABSENT'
  return null
}

function pertinenceRappelJournee(entree: EntreeRappelJournee, now: Date, reglages: ReglagesPertinence): CodeAnnulation | null {
  const { utilisateur } = entree
  if (utilisateur === null) return 'ENTITE_INTROUVABLE'
  if (!utilisateur.emailRappelJour) return 'PREFERENCE_DESACTIVEE'
  if (apresRattrapage(entree.createdAt, now, reglages.journeeRattrapageHeures)) return 'RAPPEL_PERIME'
  if (utilisateur.rendezVousDansJournee <= 0) return 'AUCUN_RENDEZ_VOUS'
  if (!utilisateur.destinataire) return 'DESTINATAIRE_ABSENT'
  return null
}

export function evaluerPertinence(
  entree: EntreePertinence,
  now: Date,
  reglages: ReglagesPertinence = REGLAGES_PERTINENCE_DEFAUT,
): CodeAnnulation | null {
  if (estRappelVisiteur(entree)) return pertinenceRappelVisiteur(entree, now, reglages)
  if (estResumeHebdo(entree)) return pertinenceResumeHebdo(entree, now, reglages)
  if (estRappelJournee(entree)) return pertinenceRappelJournee(entree, now, reglages)
  return null
}
