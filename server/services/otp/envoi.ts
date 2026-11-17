import { randomUUID } from 'node:crypto'
import { env } from '../../../shared/env'
import { buildOtpEmail } from '../emails/otp-contenu'
import { EmailTransportError, transactionalEmailTransport } from '../emails/transport'
import type { EmailTransport } from '../emails/transport'

export type OtpChannel = 'email' | 'sms' | 'whatsapp'

// Boîte aux lettres de développement : aucun fournisseur n'étant configuré en
// local (pas de clé Resend, pas de passerelle SMS), le code est déposé en
// Redis et lu par /api/dev/boite-otp, visible sur la page /connexion/code.
// Strictement inactif en production (le dépôt et la lecture sont refusés).
export const BOITE_OTP_PREFIXE = 'otp:boite:'
export const BOITE_OTP_DUREE_SECONDES = 600
const SECONDES_PAR_MINUTE = 60

export interface OtpSender {
  readonly canal: OtpChannel
  send(identifier: string, code: string, idempotencyKey?: string): Promise<void>
}

async function deposerDansLaBoite(identifier: string, code: string): Promise<void> {
  if (env.NODE_ENV === 'production') {
    return
  }
  const { redis } = await import('../../utils/redis')
  await redis.set(`${BOITE_OTP_PREFIXE}${identifier}`, code, 'EX', BOITE_OTP_DUREE_SECONDES)
}

export const ERREUR_OTP_EMAIL_ECHEC = 'OTP_EMAIL_ECHEC'
export const ERREUR_OTP_SMS_NON_CONFIGURE = 'OTP_SMS_NON_CONFIGURE'

/** Seul le code d'erreur sort d'ici : ni l'adresse ni le code (le message finit dans `failedReason` BullMQ/Redis). */
function erreurSansDonnee(error: unknown): EmailTransportError {
  return error instanceof EmailTransportError ? new EmailTransportError(error.code) : new EmailTransportError(ERREUR_OTP_EMAIL_ECHEC)
}

export class SenderOtpEmail implements OtpSender {
  readonly canal = 'email' as const

  /** Un transport injecté est TOUJOURS utilisé ; `null` = mode console / boîte de développement (aucune clé Resend). */
  constructor(private readonly transport: EmailTransport | null) {}

  async send(identifier: string, code: string, idempotencyKey: string = `otp-email:${randomUUID()}`): Promise<void> {
    const message = buildOtpEmail({
      destinataire: identifier,
      code,
      dureeMinutes: BOITE_OTP_DUREE_SECONDES / SECONDES_PAR_MINUTE,
      siteUrl: env.NUXT_PUBLIC_SITE_URL,
    })
    await deposerDansLaBoite(identifier, code)
    if (this.transport) {
      try {
        await this.transport.send(message, idempotencyKey)
      }
      catch (error) {
        throw erreurSansDonnee(error)
      }
      return
    }
    // Sans transport en production, le code ne doit jamais être écrit dans un journal.
    if (env.NODE_ENV === 'production') throw new EmailTransportError('RESEND_NON_CONFIGURE')
    console.info(`[otp:email] code pour ${identifier} : ${code}`)
  }
}

export class SenderOtpSms implements OtpSender {
  readonly canal = 'sms' as const

  async send(identifier: string, code: string): Promise<void> {
    // Aucun fournisseur SMS : en production, ni le code ni le numéro ne doivent finir dans un journal.
    if (env.NODE_ENV === 'production') throw new Error(ERREUR_OTP_SMS_NON_CONFIGURE)
    await deposerDansLaBoite(identifier, code)
    console.info(`[otp:sms] code pour ${identifier} : ${code}`)
  }
}

export class SenderOtpWhatsapp implements OtpSender {
  readonly canal = 'whatsapp' as const

  async send(): Promise<void> {
    throw new Error('WhatsApp : non implémenté (décision ouverte, voir PROJECT_STATE.md)')
  }
}

export const senderOtpEmail = new SenderOtpEmail(env.RESEND_API_KEY && env.NODE_ENV === 'production' ? transactionalEmailTransport : null)
export const senderOtpSms = new SenderOtpSms()
