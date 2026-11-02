import { z } from 'zod'

export const FILE_SYSTEM = 'system'
export const FILE_EMAILS = 'emails'

export const TRANSACTIONAL_EMAIL_TYPES = [
  'reservation_professionnel_nouvelle',
  'reservation_visiteur_recue',
  'reservation_visiteur_confirmee',
  'reservation_visiteur_annulee',
  'reservation_visiteur_refusee',
  'demande_professionnel_nouvelle',
  'demande_visiteur_recue',
  'message_professionnel_nouvelle',
] as const

export type TransactionalEmailType = (typeof TRANSACTIONAL_EMAIL_TYPES)[number]

export const TRANSACTIONAL_EMAIL_MAX_ATTEMPTS = 5
export const TRANSACTIONAL_EMAIL_BACKOFF_MS = 2_000

export const JOBS = {
  ping: 'ping',
  sendOtpEmail: 'send-otp-email',
  sendOtpSms: 'send-otp-sms',
  sendTransactionalEmail: 'send-transactional-email',
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
