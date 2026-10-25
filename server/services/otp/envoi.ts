import { env } from '../../../shared/env'

export type OtpChannel = 'email' | 'sms' | 'whatsapp'

export interface OtpSender {
  readonly canal: OtpChannel
  send(identifier: string, code: string): Promise<void>
}

export class SenderOtpEmail implements OtpSender {
  readonly canal = 'email' as const

  async send(identifier: string, code: string): Promise<void> {
    if (env.RESEND_API_KEY && env.NODE_ENV === 'production') {
      const { Resend } = await import('resend')
      const resend = new Resend(env.RESEND_API_KEY)
      const result = await resend.emails.send({
        from: 'Brandself <onboarding@resend.dev>',
        to: identifier,
        subject: 'Votre code de connexion Brandself',
        text: `Bonjour,\n\nVotre code de connexion : ${code}\n\nIl est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nÀ tout de suite,\nBrandself`,
      })
      if (result.error) {
        throw new Error(`Resend : ${result.error.message}`)
      }
      return
    }
    console.info(`[otp:email] code pour ${identifier} : ${code}`)
  }
}

export class SenderOtpSms implements OtpSender {
  readonly canal = 'sms' as const

  async send(identifier: string, code: string): Promise<void> {
    console.info(`[otp:sms] code pour ${identifier} : ${code}`)
  }
}

export class SenderOtpWhatsapp implements OtpSender {
  readonly canal = 'whatsapp' as const

  async send(): Promise<void> {
    throw new Error('WhatsApp : non implémenté (décision ouverte, voir PROJECT_STATE.md)')
  }
}

export const senderOtpEmail = new SenderOtpEmail()
export const senderOtpSms = new SenderOtpSms()
