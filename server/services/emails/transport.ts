import { Resend } from 'resend'
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

    try {
      const resend = new Resend(this.apiKey, this.baseUrl ? { baseUrl: this.baseUrl } : undefined)
      const result = await resend.emails.send({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
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
