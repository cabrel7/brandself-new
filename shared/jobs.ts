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

export const iaJobDataSchema = schemaIaJobData
export type { IaJobData }
