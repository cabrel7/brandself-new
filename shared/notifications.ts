// S9 (docs/specs/S9-notifications.md §3.1) : contrats et paramètres des notifications.
// Pur : aucune dépendance serveur. TOUTES les valeurs réglables vivent ici (futur panel admin,
// spec §11) : aucun littéral dans les services, les jobs ou les composants.
// Les listes de catégories, statuts, types et codes sont recopiées dans les CHECK de la
// migration 0020 (shared/db/schema.ts) : les garder synchronisées.

// --- Rappel visiteur (e-mail au visiteur, avant son rendez-vous) ---

/** Heures : avance du rappel sur le début du rendez-vous (durée absolue, pas de calendrier). */
export const RAPPEL_VISITEUR_AVANCE_HEURES = 24
/** Heures : pas de rappel si l'heure prévue tombe moins de 6 h après la confirmation (l'e-mail de confirmation en tient lieu). */
export const RAPPEL_VISITEUR_ECART_MIN_HEURES = 6
/** Heures : retard toléré à l'envoi sur l'heure prévue ; au-delà le rappel est abandonné. */
export const RAPPEL_VISITEUR_RATTRAPAGE_HEURES = 6
/** Heures : jamais de rappel à moins de 2 h du rendez-vous. */
export const RAPPEL_VISITEUR_PREAVIS_MIN_HEURES = 2

// --- Rendez-vous du jour (e-mail au professionnel) ---

/** Heure locale (0 à 23, fuseau de l'utilisateur) à partir de laquelle l'e-mail est planifié. */
export const RAPPEL_JOURNEE_HEURE_LOCALE = 7
/** Heures : fenêtre de rattrapage après l'heure locale (7 h + 3 h = 10 h). */
export const RAPPEL_JOURNEE_RATTRAPAGE_HEURES = 3
/** Statuts de réservation listés dans l'e-mail du jour. */
export const RAPPEL_JOURNEE_STATUTS = ['confirmee', 'en_attente'] as const
/** Lignes : nombre maximal de rendez-vous détaillés dans l'e-mail (le reste est résumé « … et n autres »). */
export const RAPPEL_JOURNEE_MAX_LIGNES = 20

// --- Résumé hebdomadaire (e-mail relationnel au professionnel) ---

/** Jour ISO de la semaine (1 = lundi … 7 = dimanche). */
export const RESUME_JOUR_ISO = 1
/** Heure locale (0 à 23, fuseau de l'utilisateur) à partir de laquelle le résumé est planifié. */
export const RESUME_HEURE_LOCALE = 8
/** Heures : fenêtre de rattrapage après l'heure locale (8 h + 6 h = 14 h). */
export const RESUME_RATTRAPAGE_HEURES = 6
/** Jours : longueur de la période résumée (jours locaux précédant le lundi). */
export const RESUME_PERIODE_JOURS = 7
/** Nombre maximal d'e-mails `relationnel` par semaine ISO locale et par destinataire. */
export const RELATIONNEL_MAX_PAR_SEMAINE = 1

/** Suggestion quand le résumé est sans activité et qu'il ne reste aucune prochaine étape. */
export const SUGGESTION_RESUME_DEFAUT = {
  titre: 'Demandez un témoignage',
  texte: 'Écrivez à un client satisfait : un avis rassure vos prochains visiteurs avant de réserver.',
  chemin: '/studio/temoignages/nouveau',
} as const

// --- Planification (ordonnanceurs BullMQ répétés : tick sur la file `system`, purge sur la file `maintenance`) ---

export const NOTIFICATIONS_SCHEDULER_ID = 'notifications-planifier'
/** Cron du tick de planification (toutes les 5 minutes). */
export const NOTIFICATIONS_TICK_CRON = '*/5 * * * *'
export const NOTIFICATIONS_TICK_TZ = 'UTC'
export const NOTIFICATIONS_PURGE_SCHEDULER_ID = 'notifications-purger'
/** Cron de la purge de l'outbox (tous les jours à 03:30 UTC). */
export const NOTIFICATIONS_PURGE_CRON = '30 3 * * *'
export const NOTIFICATIONS_PURGE_TZ = 'UTC'
/** Jours : conservation des lignes d'outbox terminales (`envoye`, `echec`, `annule`). */
export const OUTBOX_RETENTION_JOURS = 90
/** Utilisateurs : taille des lots de la planification. */
export const PLANIFICATION_LOT_UTILISATEURS = 500

// --- Débit d'envoi (limiteur BullMQ du worker `emails-notifications`, jamais appliqué aux OTP ; protège le quota Resend) ---

/** E-mails : nombre maximal d'envois par fenêtre. */
export const EMAILS_DEBIT_MAX = 2
/** Millisecondes : durée de la fenêtre de débit. */
export const EMAILS_DEBIT_FENETRE_MS = 1_000

// --- Désabonnement (jeton HMAC sans état) ---

export const DESABONNEMENT_JETON_VERSION = 'v1'
/** Jours : validité d'un jeton de désabonnement. */
export const DESABONNEMENT_JETON_VALIDITE_JOURS = 90
/** Paramètre `info` de la dérivation HKDF-SHA256 de la clé de signature. */
export const DESABONNEMENT_HKDF_INFO = 'brandself-desabonnement-v1'
/** Caractères : bornes d'un jeton (version + charge + signature, base64url). */
export const DESABONNEMENT_JETON_LONGUEUR_MIN = 20
export const DESABONNEMENT_JETON_LONGUEUR_MAX = 512
/** Chemin de l'API publique (en-tête List-Unsubscribe) et de la page de désabonnement. */
export const DESABONNEMENT_API_CHEMIN = '/api/public/desabonnement'
export const DESABONNEMENT_PAGE_CHEMIN = '/desabonnement'
/** En-tête et valeur du désabonnement en un clic (RFC 8058). */
export const LIST_UNSUBSCRIBE_POST_VALEUR = 'List-Unsubscribe=One-Click'
export const LIST_UNSUBSCRIBE_ONE_CLICK = 'One-Click'

// --- Configuration d'envoi : valeurs de repli HORS production (validées dans shared/env.ts) ---

export const EMAIL_EXPEDITEUR_DEV_DEFAUT = 'Brandself <onboarding@resend.dev>'
export const SITE_URL_DEV_DEFAUT = 'http://localhost:3000'

// --- Préférences, catégories, statuts, codes ---

export const PREFERENCES_EMAIL = ['email_hebdo', 'email_rappel_jour'] as const
export type PreferenceEmail = (typeof PREFERENCES_EMAIL)[number]

export const EMAIL_CATEGORIES = ['transactionnel', 'relationnel'] as const
export type EmailCategorie = (typeof EMAIL_CATEGORIES)[number]

export const EMAIL_STATUTS = ['en_attente', 'en_cours', 'envoye', 'echec', 'annule'] as const
export type EmailStatut = (typeof EMAIL_STATUTS)[number]

/** Motifs d'annulation d'une ligne d'outbox (colonne `erreur_code` quand `statut = 'annule'`). */
export const CODES_ANNULATION = [
  'RAPPEL_PERIME',
  'RESERVATION_NON_CONFIRMEE',
  'RESERVATION_ANNULEE',
  'PREFERENCE_DESACTIVEE',
  'VITRINE_NON_PUBLIEE',
  'ENTITE_INTROUVABLE',
  'AUCUN_RENDEZ_VOUS',
  'DESTINATAIRE_ABSENT',
  'PLAFOND_RELATIONNEL',
] as const
export type CodeAnnulation = (typeof CODES_ANNULATION)[number]

/** Libellés (vouvoiement) de chaque préférence, pour la page de désabonnement et le Compte. */
export const PREFERENCES_EMAIL_LIBELLES: Record<PreferenceEmail, { titre: string, objet: string }> = {
  email_hebdo: { titre: 'Résumé de la semaine', objet: 'le résumé de la semaine' },
  email_rappel_jour: { titre: 'Rendez-vous du jour', objet: 'les rendez-vous du jour' },
}
