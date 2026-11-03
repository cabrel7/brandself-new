import { z } from 'zod'
import { schemaIaJobData } from './schemas/ia'
import type { IaJobData } from './schemas/ia'

export const FILE_SYSTEM = 'system'
export const FILE_EMAILS = 'emails'
export const FILE_IA = 'ia'

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
