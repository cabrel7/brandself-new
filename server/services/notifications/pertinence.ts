import {
  RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  RAPPEL_VISITEUR_AVANCE_HEURES,
  RAPPEL_VISITEUR_PREAVIS_MIN_HEURES,
  RAPPEL_VISITEUR_RATTRAPAGE_HEURES,
  RESUME_RATTRAPAGE_HEURES,
} from '../../../shared/notifications'
import type { CodeAnnulation } from '../../../shared/notifications'
import { ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES, ABONNEMENT_RAPPELS_JOURS } from '../../../shared/plans'
import type { AbonnementRappelJours } from '../../../shared/plans'
import { HEURE_MS } from '../../../shared/temps'

// S9 (docs/specs/S9-notifications.md #83, #102, §4.4) : revalidation PURE d'une ligne d'outbox juste
// avant l'envoi. Les faits (réservation, préférences, vitrine publiée, nombre de rendez-vous du jour,
// destinataire) sont chargés par l'appelant (email-outbox.ts) ; ici on ne fait que décider.
// Renvoie le code d'annulation, ou `null` si l'e-mail peut partir. L'ordre des contrôles est l'ordre
// de priorité des codes de la spec.
// S10 (docs/specs/S10-abonnements.md #122, #123) : deux types s'y ajoutent, `abonnement_rappel` (clé
// d'occurrence `J{7|3|0}:{expire_le ISO}`, helpers purs ci-dessous) et `paiement_confirme` (reçu).

// --- Clé d'occurrence des rappels d'abonnement (S10 #122) ---

/** Caractères : longueur maximale d'une occurrence d'abonnement (`J7:` + ISO 8601 UTC de 24 caractères = 27). */
export const OCCURRENCE_RAPPEL_ABONNEMENT_LONGUEUR_MAX = 32
const PREFIXE_JOURS = 'J'
const SEPARATEUR_OCCURRENCE = ':'
const OCCURRENCE_RAPPEL_FORMAT = /^J(\d{1,2}):(.+)$/

/** `J7:2026-12-03T23:00:00.000Z` : le rappel est lié à UNE échéance, un renouvellement en change la clé. */
export function construireOccurrenceRappel(jours: AbonnementRappelJours, expireLe: Date): string {
  const occurrence = `${PREFIXE_JOURS}${jours}${SEPARATEUR_OCCURRENCE}${expireLe.toISOString()}`
  if (occurrence.length > OCCURRENCE_RAPPEL_ABONNEMENT_LONGUEUR_MAX) throw new RangeError('occurrence trop longue')
  return occurrence
}

/** Inverse de `construireOccurrenceRappel` ; `null` si la clé n'a pas exactement cette forme. */
export function analyserOccurrenceRappel(occurrence: string): { jours: AbonnementRappelJours, expireLe: Date } | null {
  const correspondance = OCCURRENCE_RAPPEL_FORMAT.exec(occurrence)
  if (correspondance === null) return null
  const jours = ABONNEMENT_RAPPELS_JOURS.find((valeur) => String(valeur) === correspondance[1])
  const iso = correspondance[2]
  if (jours === undefined || iso === undefined) return null
  const expireLe = new Date(iso)
  // Aller-retour exact : refuse toute forme ambiguë (« 2026-12-03 », fuseau explicite, espaces…).
  if (Number.isNaN(expireLe.getTime()) || expireLe.toISOString() !== iso) return null
  return { jours, expireLe }
}

interface EntreeBase {
  /** Clé d'occurrence de la ligne d'outbox. */
  occurrence: string
  /** Date de création de la ligne : référence du rattrapage des e-mails du professionnel. */
  createdAt: Date
}

export interface EntreeRappelVisiteur extends EntreeBase {
  type: 'reservation_visiteur_rappel'
  /** `null` : réservation introuvable. `statut` est celui de la base (chaîne). */
  reservation: { statut: string, rappelEmail: boolean, debut: Date, vitrinePubliee: boolean } | null
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

export interface EntreeRappelAbonnement extends EntreeBase {
  type: 'abonnement_rappel'
  /** `null` : abonnement introuvable. `expireLe` est l'échéance COURANTE (exclusive) de l'abonnement. */
  abonnement: { expireLe: Date, destinataire: boolean } | null
}

export interface EntreePaiementConfirme extends EntreeBase {
  type: 'paiement_confirme'
  /**
   * `null` : paiement introuvable. `statut` est celui de la base (chaîne). `utilisateurPresent` : le compte
   * existe encore (`paiements.user_id` passe à NULL à la suppression du compte). `destinataire` : adresse d'envoi.
   */
  paiement: { statut: string, utilisateurPresent: boolean, destinataire: boolean } | null
}

/** Types historiques (S7) : jamais annulés par la revalidation (pas de régression, #102). */
export interface EntreeHistorique extends EntreeBase {
  type: string
}

export type EntreePertinence =
  | EntreeRappelVisiteur
  | EntreeResumeHebdo
  | EntreeRappelJournee
  | EntreeRappelAbonnement
  | EntreePaiementConfirme
  | EntreeHistorique

/** Paramètres réglables ; les valeurs par défaut viennent de shared/notifications.ts et shared/plans.ts. */
export interface ReglagesPertinence {
  rappelAvanceHeures: number
  rappelRattrapageHeures: number
  /** Garde défensive : inatteignable avec les valeurs par défaut (le rattrapage de 6 h la couvre). */
  rappelPreavisMinHeures: number
  resumeRattrapageHeures: number
  journeeRattrapageHeures: number
  abonnementRattrapageHeures: number
}

export const REGLAGES_PERTINENCE_DEFAUT: ReglagesPertinence = {
  rappelAvanceHeures: RAPPEL_VISITEUR_AVANCE_HEURES,
  rappelRattrapageHeures: RAPPEL_VISITEUR_RATTRAPAGE_HEURES,
  rappelPreavisMinHeures: RAPPEL_VISITEUR_PREAVIS_MIN_HEURES,
  resumeRattrapageHeures: RESUME_RATTRAPAGE_HEURES,
  journeeRattrapageHeures: RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  abonnementRattrapageHeures: ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES,
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

function estRappelAbonnement(entree: EntreePertinence): entree is EntreeRappelAbonnement {
  return entree.type === 'abonnement_rappel'
}

function estPaiementConfirme(entree: EntreePertinence): entree is EntreePaiementConfirme {
  return entree.type === 'paiement_confirme'
}

function apresRattrapage(creeLe: Date, now: Date, heures: number): boolean {
  return now.getTime() > creeLe.getTime() + heures * HEURE_MS
}

function pertinenceRappelVisiteur(entree: EntreeRappelVisiteur, now: Date, reglages: ReglagesPertinence): CodeAnnulation | null {
  const { reservation } = entree
  if (reservation === null) return 'ENTITE_INTROUVABLE'
  if (reservation.statut !== 'confirmee') return 'RESERVATION_NON_CONFIRMEE'
  if (!reservation.rappelEmail) return 'PREFERENCE_DESACTIVEE'
  // Vitrine dépubliée depuis la planification : plus rien ne doit partir en son nom (comme le résumé).
  if (!reservation.vitrinePubliee) return 'VITRINE_NON_PUBLIEE'
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

/**
 * S10 #122 : le rappel est lié à l'échéance qui l'a fait naître (occurrence). Échéance différente de l'échéance
 * courante : renouvelé (`ABONNEMENT_RENOUVELE`). Échéance atteinte ou rattrapage dépassé : `RAPPEL_PERIME`.
 */
function pertinenceRappelAbonnement(entree: EntreeRappelAbonnement, now: Date, reglages: ReglagesPertinence): CodeAnnulation | null {
  const { abonnement } = entree
  if (abonnement === null) return 'ENTITE_INTROUVABLE'
  const rappel = analyserOccurrenceRappel(entree.occurrence)
  if (rappel === null) return 'RAPPEL_PERIME'
  if (rappel.expireLe.getTime() !== abonnement.expireLe.getTime()) return 'ABONNEMENT_RENOUVELE'
  if (now.getTime() >= abonnement.expireLe.getTime()) return 'RAPPEL_PERIME'
  if (apresRattrapage(entree.createdAt, now, reglages.abonnementRattrapageHeures)) return 'RAPPEL_PERIME'
  if (!abonnement.destinataire) return 'DESTINATAIRE_ABSENT'
  return null
}

/** S10 #123 : le reçu ne part que pour un paiement `reussi`. Aucune péremption : un reçu en retard reste utile. */
function pertinencePaiementConfirme(entree: EntreePaiementConfirme): CodeAnnulation | null {
  const { paiement } = entree
  if (paiement === null) return 'ENTITE_INTROUVABLE'
  if (paiement.statut !== 'reussi') return 'PAIEMENT_NON_REUSSI'
  if (!paiement.utilisateurPresent) return 'ENTITE_INTROUVABLE'
  if (!paiement.destinataire) return 'DESTINATAIRE_ABSENT'
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
  if (estRappelAbonnement(entree)) return pertinenceRappelAbonnement(entree, now, reglages)
  if (estPaiementConfirme(entree)) return pertinencePaiementConfirme(entree)
  return null
}
