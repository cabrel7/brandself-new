export const FILE_SYSTEME = 'systeme'
export const FILE_EMAILS = 'emails'

export const JOBS = {
  ping: 'ping',
  envoyerOtpEmail: 'envoyer-otp-email',
  envoyerOtpSms: 'envoyer-otp-sms',
} as const

export type NomJob = (typeof JOBS)[keyof typeof JOBS]

export interface DonneesOtpJob {
  identifiant: string
  code: string
}
