import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JOBS } from '../../shared/jobs'
import { processOtpJob } from '../../server/jobs/otp'
import { redis } from '../../server/utils/redis'
import { EmailTransportError } from '../../server/services/emails/transport'
import type { EmailMessage, EmailTransport } from '../../server/services/emails/transport'
import { BOITE_OTP_PREFIXE, SenderOtpEmail } from '../../server/services/otp/envoi'

// ÉTAPE 1 (RED) — décision #26 : l'OTP e-mail passe par le transport (idempotence, html, validation d'en-têtes).
// CONTRAT SUPPOSÉ : `new SenderOtpEmail(transport)` ; si un transport est injecté, il est TOUJOURS utilisé (même hors
// production) ; `send(identifier, code, idempotencyKey?)`. Le worker passe `otp-email:<file>:<id>:<timestamp>` (cleIdempotenceOtp).
// Redis RÉEL (boîte OTP de développement) ; le seul élément factice est le transport (Resend, hors périmètre).

const ADRESSE = 'alice.secrete@exemple.test'
const CODE = '123456'
const identifiants = new Set<string>()

class Enregistreur implements EmailTransport {
  readonly envois: Array<{ message: EmailMessage, cle: string }> = []

  constructor(private readonly echec?: Error) {}

  async send(message: EmailMessage, cle: string): Promise<void> {
    this.envois.push({ message, cle })
    if (this.echec) throw this.echec
  }
}

function adresse(suffixe: string): string {
  const valeur = `${suffixe}.${ADRESSE}`
  identifiants.add(valeur)
  return valeur
}

afterEach(async () => {
  for (const id of identifiants) await redis.del(`${BOITE_OTP_PREFIXE}${id}`)
  identifiants.clear()
})

describe('SenderOtpEmail via transport injecté', () => {
  it('should send the OTP e-mail through the injected transport with the key given by the worker', async () => {
    const transport = new Enregistreur()
    const destinataire = adresse('a')

    await new SenderOtpEmail(transport).send(destinataire, CODE, 'otp-email:messages-auth:42:1700000000000')

    expect(transport.envois).toHaveLength(1)
    expect(transport.envois[0]?.cle).toBe('otp-email:messages-auth:42:1700000000000')
    const { message } = transport.envois[0] as { message: EmailMessage }
    expect(message.to).toBe(destinataire)
    expect(message.subject).toBe('Votre code de connexion jesuis.pro')
    expect(message.text).toContain(`Votre code de connexion : ${CODE}`)
    expect(message.html).toContain(CODE)
    expect(message.replyTo).toBeUndefined()
  })

  it('should send two jobs with two different keys (a retry of the same job reuses its key)', async () => {
    const transport = new Enregistreur()
    const sender = new SenderOtpEmail(transport)
    const destinataire = adresse('b')

    await sender.send(destinataire, CODE, 'otp-email:messages-auth:42:1700000000000')
    await sender.send(destinataire, CODE, 'otp-email:messages-auth:42:1700000000000')
    await sender.send(destinataire, '654321', 'otp-email:43')

    expect(transport.envois.map((e) => e.cle)).toEqual(['otp-email:messages-auth:42:1700000000000', 'otp-email:messages-auth:42:1700000000000', 'otp-email:43'])
  })

  it('should keep writing the development mailbox in Redis (non production)', async () => {
    const destinataire = adresse('c')

    await new SenderOtpEmail(new Enregistreur()).send(destinataire, CODE, 'otp-email:44')

    expect(await redis.get(`${BOITE_OTP_PREFIXE}${destinataire}`)).toBe(CODE)
  })

  it('should keep the transport error code and never put the address or the code in the thrown error', async () => {
    const destinataire = adresse('d')
    const transport = new Enregistreur(new EmailTransportError('RESEND_INTERNAL_SERVER_ERROR'))

    const erreur = await new SenderOtpEmail(transport).send(destinataire, CODE, 'otp-email:45').then(() => null, (e: unknown) => e as Error)

    expect(erreur).not.toBeNull()
    expect(erreur?.message).toContain('RESEND_INTERNAL_SERVER_ERROR')
    expect(erreur?.message).not.toContain(destinataire)
    expect(erreur?.message).not.toContain(CODE)
  })

  it('should hide a provider message that contains the address (unknown error type)', async () => {
    const destinataire = adresse('e')
    const transport = new Enregistreur(new Error(`Échec pour ${destinataire} avec le code ${CODE}`))

    const erreur = await new SenderOtpEmail(transport).send(destinataire, CODE, 'otp-email:46').then(() => null, (e: unknown) => e as Error)

    expect(erreur).not.toBeNull()
    expect(erreur?.message).not.toContain(destinataire)
    expect(erreur?.message).not.toContain(CODE)
  })

  it('should refuse an invalid code before any send (OTP_CODE_INVALIDE) ', async () => {
    const transport = new Enregistreur()

    await expect(new SenderOtpEmail(transport).send(adresse('f'), 'abc', 'otp-email:47')).rejects.toThrow('OTP_CODE_INVALIDE')
    expect(transport.envois).toHaveLength(0)
  })
})

describe('processOtpJob : clé d’idempotence de l’OTP e-mail', () => {
  it('should send the e-mail with the key given by the worker and never pass the key to the SMS sender', async () => {
    const transport = new Enregistreur()
    const sms: string[] = []
    const senders = {
      email: new SenderOtpEmail(transport),
      sms: { canal: 'sms' as const, send: async (identifier: string, code: string, cle?: string) => { sms.push(`${identifier}|${code}|${cle ?? ''}`) } },
    }
    const destinataire = adresse('g')

    await processOtpJob(JOBS.sendOtpEmail, { identifier: destinataire, code: CODE }, 'otp-email:77', senders)
    await processOtpJob(JOBS.sendOtpSms, { identifier: '+237699000011', code: '654321' }, 'otp-email:78', senders)

    expect(transport.envois.map((e) => e.cle)).toEqual(['otp-email:77'])
    expect(sms).toEqual(['+237699000011|654321|'])
  })

  it('should reject unknown jobs and invalid job data without echoing the address or the code', async () => {
    const senders = { email: new SenderOtpEmail(new Enregistreur()), sms: new SenderOtpEmail(new Enregistreur()) }

    await expect(processOtpJob('inconnu', {}, 'otp-email:1', senders)).rejects.toThrow('Unknown job')
    const erreur = await processOtpJob(JOBS.sendOtpEmail, { identifier: ADRESSE, code: CODE, extra: 1 }, 'otp-email:2', senders).then(() => null, (e: unknown) => e as Error)
    expect(erreur?.message).toBe('OTP_JOB_INVALIDE')
  })

  // worker/index.ts démarre des Workers BullMQ à l'import : non importable en test. Le worker ne fait que transmettre
  // cleIdempotenceOtp(job.queueName, job.id, job.timestamp) à processOtpJob ; la file vient du job, donc les DEUX files (messages-auth et legacy) passent par la même fonction ; contrôle statique du câblage.
  it('should wire cleIdempotenceOtp(job.queueName, job.id, job.timestamp) from the worker to processOtpJob (both queues)', () => {
    const source = readFileSync(path.resolve(__dirname, '../../worker/index.ts'), 'utf8')

    // A4 : le numéro de tentative (`job.attemptsMade + 1`) est transmis en 5e argument pour le journal d'envoi des codes.
    expect(source).toMatch(/processOtpJobData\(job\.name, job\.data, cleIdempotenceOtp\(job\.queueName, job\.id, job\.timestamp\), undefined, job\.attemptsMade \+ 1\)/)
    expect(source).toMatch(/FILE_MESSAGES_AUTH,\s+processOtpJob,/)
    expect(source).toContain('await processOtpJob(job)')
    expect(source).not.toContain('`otp-email:${job.id}`')
  })
})
