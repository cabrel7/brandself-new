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
