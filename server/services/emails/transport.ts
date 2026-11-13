import { Resend } from 'resend'
import { z } from 'zod'
import { env } from '../../../shared/env'

const EMAIL_TIMEOUT_MS = 10_000
const ERROR_CODE_MAX_LENGTH = 64

export interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType: string
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  /** Version HTML (décision #26) ; `text` reste toujours envoyé en alternative. */
  html?: string
  /** Adresse de réponse (validée, sans saut de ligne) ; émise par le SDK en `reply_to`. */
  replyTo?: string
  attachments: EmailAttachment[]
  /** En-têtes SMTP supplémentaires (S9 : `List-Unsubscribe` et `List-Unsubscribe-Post`, RFC 8058). */
  headers?: Record<string, string>
}

export interface EmailTransport {
  send(message: EmailMessage, idempotencyKey: string): Promise<void>
}

export class EmailTransportError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'EmailTransportError'
    this.code = code
  }
}

const LINE_BREAK = /[\r\n]/
const replyToSchema = z.email()

/** Garde-fous exécutés AVANT tout appel HTTP (injection d'en-têtes). Aucune valeur refusée n'est reprise dans l'erreur. */
function assertSafeMessage(message: EmailMessage): void {
  if (message.replyTo !== undefined && (LINE_BREAK.test(message.replyTo) || !replyToSchema.safeParse(message.replyTo).success)) {
    throw new EmailTransportError('REPLY_TO_INVALIDE')
  }
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    if (LINE_BREAK.test(name) || LINE_BREAK.test(value)) throw new EmailTransportError('EN_TETE_INVALIDE')
  }
}

function safeResendErrorCode(value: string): string {
  const suffix = value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  return `RESEND_${suffix || 'ERREUR'}`.slice(0, ERROR_CODE_MAX_LENGTH)
}

export class ResendEmailTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string | undefined = env.RESEND_API_KEY,
    private readonly baseUrl?: string,
    // Expéditeur issu de la configuration validée (obligatoire en production, domaine vérifié).
    private readonly from: string = env.EMAIL_EXPEDITEUR,
  ) {}

  async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
    if (!this.apiKey) throw new EmailTransportError('RESEND_NON_CONFIGURE')
    assertSafeMessage(message)

    try {
      const resend = new Resend(this.apiKey, this.baseUrl ? { baseUrl: this.baseUrl } : undefined)
      const result = await resend.emails.send({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        attachments: message.attachments,
        ...(message.headers ? { headers: message.headers } : {}),
      }, {
        idempotencyKey,
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      })
      if (result.error) throw new EmailTransportError(safeResendErrorCode(result.error.name))
    }
    catch (error) {
      if (error instanceof EmailTransportError) throw error
      throw new EmailTransportError('RESEND_INDISPONIBLE')
    }
  }
}

export const transactionalEmailTransport = new ResendEmailTransport()
