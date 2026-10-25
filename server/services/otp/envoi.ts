import { env } from '../../../shared/env'

export type CanalOtp = 'email' | 'sms' | 'whatsapp'

export interface OtpSender {
  readonly canal: CanalOtp
  envoyer(identifiant: string, code: string): Promise<void>
}

export class SenderOtpEmail implements OtpSender {
  readonly canal = 'email' as const

  async envoyer(identifiant: string, code: string): Promise<void> {
    if (env.RESEND_API_KEY && env.NODE_ENV === 'production') {
      const { Resend } = await import('resend')
      const resend = new Resend(env.RESEND_API_KEY)
      const resultat = await resend.emails.send({
        from: 'Brandself <onboarding@resend.dev>',
        to: identifiant,
        subject: 'Votre code de connexion Brandself',
        text: `Bonjour,\n\nVotre code de connexion : ${code}\n\nIl est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nÀ tout de suite,\nBrandself`,
      })
      if (resultat.error) {
        throw new Error(`Resend : ${resultat.error.message}`)
      }
      return
    }
    console.info(`[otp:email] code pour ${identifiant} : ${code}`)
  }
}

export class SenderOtpSms implements OtpSender {
  readonly canal = 'sms' as const

  async envoyer(identifiant: string, code: string): Promise<void> {
    console.info(`[otp:sms] code pour ${identifiant} : ${code}`)
  }
}

export class SenderOtpWhatsapp implements OtpSender {
  readonly canal = 'whatsapp' as const

  async envoyer(): Promise<void> {
    throw new Error('WhatsApp : non implémenté (décision ouverte, voir PROJECT_STATE.md)')
  }
}

export const senderOtpEmail = new SenderOtpEmail()
export const senderOtpSms = new SenderOtpSms()
