export const FILE_SYSTEM = 'system'
export const FILE_EMAILS = 'emails'

export const JOBS = {
  ping: 'ping',
  sendOtpEmail: 'send-otp-email',
  sendOtpSms: 'send-otp-sms',
} as const

export type JobName = (typeof JOBS)[keyof typeof JOBS]

export interface OtpJobData {
  identifier: string
  code: string
}
