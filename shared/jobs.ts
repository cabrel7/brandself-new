import { z } from 'zod'
import { schemaIaJobData } from './schemas/ia'
import type { IaJobData } from './schemas/ia'

// Une file = une nature de travail et un profil de latence. Une opération sensible à la latence n'attend
// jamais derrière une opération lente ou limitée en débit.
/** Système : ping et tick de planification des notifications (courts, sans appel externe). */
export const FILE_SYSTEM = 'system'
/** Maintenance : purges quotidiennes (IA, inscriptions abandonnées, outbox). Lentes, jamais urgentes. */
export const FILE_MAINTENANCE = 'maintenance'
/** Authentification : OTP e-mail et SMS. Sensible à la latence, JAMAIS de limiteur de débit. */
export const FILE_MESSAGES_AUTH = 'messages-auth'
/** E-mails de notification (outbox transactionnelle et relationnelle) : avec limiteur de débit (quota Resend). */
export const FILE_EMAILS_NOTIFICATIONS = 'emails-notifications'
/** Générations IA (jusqu'à 25 s) : jamais partagée. */
export const FILE_IA = 'ia'
/** S10 : rapprochement des paiements avec le fournisseur (appels réseau bornés par un budget global). */
export const FILE_PAIEMENTS = 'paiements'
/**
 * Ancienne file unique `emails` (OTP + outbox), avant la séparation. Plus aucun producteur n'y écrit : un
 * worker de transition la vide pendant une release (voir docs/specs/S9-notifications.md, notes de déploiement).
 */
export const FILE_EMAILS_LEGACY = 'emails'

/** Concurrence par file (jobs traités en parallèle par le worker). */
export const SYSTEM_CONCURRENCE_WORKER = 1
export const MAINTENANCE_CONCURRENCE_WORKER = 1
/** Les OTP sont indépendants et courts : on les traite en parallèle pour ne jamais former de file d'attente. */
export const MESSAGES_AUTH_CONCURRENCE_WORKER = 5
/** Le débit réel des notifications est fixé par le limiteur ; une seule exécution à la fois suffit. */
export const EMAILS_NOTIFICATIONS_CONCURRENCE_WORKER = 1
/** Un seul tick de vérification à la fois : le budget d'appels K-PAY est partagé avec l'initiation. */
export const PAIEMENTS_CONCURRENCE_WORKER = 1

/** Options des jobs OTP (e-mail et SMS). */
export const OTP_JOB_MAX_ATTEMPTS = 3
export const OTP_JOB_BACKOFF_MS = 2_000
export const OTP_JOB_GARDER_REUSSIS = 100
export const OTP_JOB_GARDER_ECHECS = 200

export const TRANSACTIONAL_EMAIL_TYPES = [
  'reservation_professionnel_nouvelle',
  'reservation_visiteur_recue',
  'reservation_visiteur_confirmee',
  'reservation_visiteur_annulee',
  'reservation_visiteur_refusee',
  'demande_professionnel_nouvelle',
  'demande_visiteur_recue',
  'message_professionnel_nouvelle',
  // S9 : e-mails planifiés (rappel visiteur, rendez-vous du jour, résumé hebdomadaire).
  'reservation_visiteur_rappel',
  'utilisateur_resume_hebdo',
  'utilisateur_rappel_journee',
  // S10 : rappels d'échéance de l'abonnement (planifiés) et reçu de paiement (immédiat).
  'abonnement_rappel',
  'paiement_confirme',
] as const

export type TransactionalEmailType = (typeof TRANSACTIONAL_EMAIL_TYPES)[number]

export const TRANSACTIONAL_EMAIL_MAX_ATTEMPTS = 5
export const TRANSACTIONAL_EMAIL_BACKOFF_MS = 2_000

export const JOBS = {
  ping: 'ping',
  sendOtpEmail: 'send-otp-email',
  sendOtpSms: 'send-otp-sms',
  sendTransactionalEmail: 'send-transactional-email',
  genererIa: 'ia-generer',
  purgerIa: 'ia-purger',
  planifierNotifications: 'notifications-planifier',
  purgerNotifications: 'notifications-purger',
  verifierPaiements: 'paiements-verifier',
} as const

export type JobName = (typeof JOBS)[keyof typeof JOBS]

export interface OtpJobData {
  identifier: string
  code: string
}

export const transactionalEmailJobDataSchema = z.strictObject({
  outboxId: z.uuid(),
})

export type TransactionalEmailJobData = z.infer<typeof transactionalEmailJobDataSchema>

// S8 : file `ia`. Une génération = un job (jobId unique) ; la purge est un job répété quotidien.
export const IA_JOB_ID_PREFIXE = 'ia-generation-'
export const IA_JOB_LOCK_MS = 60_000
export const IA_JOB_MAX_STALLED = 1
export const IA_PURGE_SCHEDULER_ID = 'ia-purger'
export const IA_PURGE_CRON = '0 3 * * *'
export const IA_PURGE_TZ = 'UTC'

// S10 : file `paiements`. Un ordonnanceur répété (tick) réclame les paiements dus ; aucune donnée personnelle
// ne transite par Redis (le job ne porte aucune charge utile).
export const PAIEMENTS_SCHEDULER_ID = 'paiements-verifier'
/** Millisecondes entre deux ticks de vérification. */
export const PAIEMENTS_TICK_MS = 10_000
/** Paiements traités au plus par tick (5 par 10 s = 30 appels par minute au plus, sous le budget de 60). */
export const PAIEMENTS_VERIFICATION_LOT = 5
/** Secondes avant la prochaine vérification d'un paiement, selon le nombre de vérifications déjà faites (le dernier pas se répète). */
export const PAIEMENTS_VERIFICATION_CALENDRIER_S = [15, 30, 60, 120, 300] as const
/** Minutes : au-delà, un paiement `cree` ou `en_attente` passe localement à `expire` (un `completed` tardif reste appliqué). */
export const PAIEMENT_EXPIRATION_MINUTES = 15

export const iaJobDataSchema = schemaIaJobData
export type { IaJobData }
