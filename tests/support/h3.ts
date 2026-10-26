import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import type { H3Event } from 'h3'

export interface FakeEventOptions {
  method?: string
  url?: string
  headers?: Record<string, string>
  /** Corps JSON déjà sérialisé. */
  body?: string
  /** Paramètres de route (`/:id`), tels que Nitro les place dans event.context.params. */
  params?: Record<string, string>
}

/** Événement h3 réel (pas de mock de h3) construit sur des objets http Node non connectés. */
export function fakeEvent(options: FakeEventOptions = {}): H3Event {
  const req = new IncomingMessage(new Socket())
  req.method = options.method ?? 'GET'
  req.url = options.url ?? '/'
  for (const [nom, valeur] of Object.entries(options.headers ?? {})) {
    req.headers[nom.toLowerCase()] = valeur
  }
  if (options.body !== undefined) {
    req.headers['content-type'] = 'application/json'
    req.headers['content-length'] = String(Buffer.byteLength(options.body))
    req.push(options.body)
    req.push(null)
  }
  const res = new ServerResponse(req)
  const event = createEvent(req, res)
  event.context.params = options.params
  return event
}
