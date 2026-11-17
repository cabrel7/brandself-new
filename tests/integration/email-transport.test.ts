import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { ResendEmailTransport } from '../../server/services/emails/transport'

interface ReceivedRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage['headers']
  body: unknown
}

async function readRequest(request: IncomingMessage): Promise<ReceivedRequest> {
  let body = ''
  for await (const chunk of request) body += chunk.toString()
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: JSON.parse(body),
  }
}

async function withHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Adresse du serveur HTTP de test indisponible.')
  try {
    await run(`http://127.0.0.1:${address.port}`)
  }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

describe('transport Resend transactionnel', () => {
  it('effectue un vrai appel HTTP local avec la clé d’idempotence et la pièce jointe', async () => {
    let received: ReceivedRequest | undefined
    await withHttpServer(async (request, response) => {
      received = await readRequest(request)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'email-test-1' }))
    }, async (baseUrl) => {
      const transport = new ResendEmailTransport('re_test', baseUrl)
      await transport.send({
        to: 'visiteur@exemple.test',
        subject: 'Votre réservation est confirmée',
        text: 'Votre rendez-vous est confirmé.',
        attachments: [{
          filename: 'reservation.ics',
          content: Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'),
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        }],
      }, 'brandself-email-11111111-1111-4111-8111-111111111111')
    })

    expect(received).toMatchObject({ method: 'POST', url: '/emails' })
    expect(received?.headers['idempotency-key']).toBe('brandself-email-11111111-1111-4111-8111-111111111111')
    expect(received?.body).toMatchObject({
      to: 'visiteur@exemple.test',
      subject: 'Votre réservation est confirmée',
      attachments: [{ filename: 'reservation.ics', content_type: 'text/calendar; charset=utf-8; method=REQUEST' }],
    })
  })

  it('ne propage jamais le message potentiellement sensible du fournisseur', async () => {
    const sensitiveProviderMessage = 'Échec pour alice.personnelle@exemple.test : dossier médical secret'
    await withHttpServer(async (_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        name: 'internal_server_error',
        message: sensitiveProviderMessage,
        statusCode: 500,
      }))
    }, async (baseUrl) => {
      const transport = new ResendEmailTransport('re_test', baseUrl)
      const promise = transport.send({
        to: 'visiteur@exemple.test',
        subject: 'Votre demande a bien été reçue',
        text: 'Votre demande a été transmise.',
        attachments: [],
      }, 'brandself-email-22222222-2222-4222-8222-222222222222')

      await expect(promise).rejects.toMatchObject({
        name: 'EmailTransportError',
        code: 'RESEND_INTERNAL_SERVER_ERROR',
        message: 'RESEND_INTERNAL_SERVER_ERROR',
      })
      await expect(promise).rejects.not.toThrow(sensitiveProviderMessage)
    })
  })
})

// Décision #26 (e-mails HTML) : `html`, `replyTo`, en-têtes. Serveur HTTP local réel ; le SDK `resend` installé (6.34.1)
// traduit `replyTo` en champ `reply_to` (constaté dans node_modules/resend/dist/index.mjs, parseEmailToApiOptions).
const CLE = 'brandself-email-33333333-3333-4333-8333-333333333333'
const MESSAGE_BASE = {
  to: 'visiteur@exemple.test',
  subject: 'Votre réservation est confirmée',
  text: 'Texte brut',
  attachments: [],
}

async function capturer(message: Parameters<ResendEmailTransport['send']>[0]): Promise<{ requetes: ReceivedRequest[], erreur: unknown }> {
  const requetes: ReceivedRequest[] = []
  let erreur: unknown
  await withHttpServer(async (request, response) => {
    requetes.push(await readRequest(request))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'email-test-2' }))
  }, async (baseUrl) => {
    try {
      await new ResendEmailTransport('re_test', baseUrl).send(message, CLE)
    }
    catch (e) {
      erreur = e
    }
  })
  return { requetes, erreur }
}

describe('transport Resend : html, replyTo, en-têtes (décision #26)', () => {
  it('should send html and text together, with the idempotency key', async () => {
    const { requetes, erreur } = await capturer({ ...MESSAGE_BASE, html: '<p>Bonjour</p>' } as never)

    expect(erreur).toBeUndefined()
    expect(requetes).toHaveLength(1)
    expect(requetes[0]?.body).toMatchObject({ html: '<p>Bonjour</p>', text: 'Texte brut' })
    expect(requetes[0]?.headers['idempotency-key']).toBe(CLE)
  })

  it('should send replyTo as the real field emitted by the installed SDK (reply_to)', async () => {
    const { requetes } = await capturer({ ...MESSAGE_BASE, replyTo: 'contact@cabinet.test' } as never)

    const corps = requetes[0]?.body as Record<string, unknown>
    expect(corps.reply_to).toBe('contact@cabinet.test')
    expect('replyTo' in corps).toBe(false)
  })

  it('should send custom headers and attachments next to html', async () => {
    const { requetes } = await capturer({
      ...MESSAGE_BASE,
      html: '<p>x</p>',
      headers: { 'List-Unsubscribe': '<https://jesuis.pro/api/public/desabonnement?jeton=abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      attachments: [{ filename: 'reservation.ics', content: Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'), contentType: 'text/calendar; charset=utf-8; method=REQUEST' }],
    } as never)

    expect(requetes[0]?.body).toMatchObject({
      headers: { 'List-Unsubscribe': '<https://jesuis.pro/api/public/desabonnement?jeton=abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      attachments: [{ filename: 'reservation.ics', content_type: 'text/calendar; charset=utf-8; method=REQUEST' }],
    })
  })

  it('should not emit any html key (nor reply_to) for a plain text message', async () => {
    const { requetes } = await capturer(MESSAGE_BASE)

    const corps = requetes[0]?.body as Record<string, unknown>
    expect('html' in corps).toBe(false)
    expect('reply_to' in corps).toBe(false)
  })

  it.each([
    ['CRLF', 'a@b.test\r\nBcc: pirate@exemple.test'],
    ['LF', 'a@b.test\nBcc: pirate@exemple.test'],
    ['CR', 'a@b.test\rBcc: pirate@exemple.test'],
  ])('should refuse a replyTo containing %s with REPLY_TO_INVALIDE and send no HTTP request', async (_libelle, replyTo) => {
    const { requetes, erreur } = await capturer({ ...MESSAGE_BASE, replyTo } as never)

    expect(erreur).toMatchObject({ name: 'EmailTransportError', code: 'REPLY_TO_INVALIDE' })
    expect(requetes).toHaveLength(0)
  })

  it.each([
    ['a CRLF in a value', { 'X-Test': 'ok\r\nBcc: pirate@exemple.test' }],
    ['a LF in a value', { 'X-Test': 'ok\nBcc: pirate@exemple.test' }],
    ['a CRLF in a name', { 'X-Test\r\nBcc: pirate@exemple.test': 'ok' }],
  ])('should refuse a header with %s with EN_TETE_INVALIDE and send no HTTP request', async (_libelle, headers) => {
    const { requetes, erreur } = await capturer({ ...MESSAGE_BASE, headers })

    expect(erreur).toMatchObject({ name: 'EmailTransportError', code: 'EN_TETE_INVALIDE' })
    expect(requetes).toHaveLength(0)
  })

  it('should not put the refused address in the error message', async () => {
    const { erreur } = await capturer({ ...MESSAGE_BASE, replyTo: 'secret@exemple.test\r\nBcc: x@y.test' } as never)

    expect((erreur as Error).message).toBe('REPLY_TO_INVALIDE')
  })
})
