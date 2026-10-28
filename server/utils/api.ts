import { createError, defineEventHandler, isError } from 'h3'
import type { EventHandlerRequest, H3Error, H3Event } from 'h3'
import { DomainError, ERROR_MESSAGES, TooManyRequestsError } from '../exceptions/http'

const SQLSTATE_RE = /^[0-9A-Z]{5}$/

function describeUnknown(error: unknown): { nom: string, sqlstate?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' && SQLSTATE_RE.test(code)
      ? { nom: error.name, sqlstate: code }
      : { nom: error.name }
  }
  return { nom: typeof error }
}

/**
 * Traduit toute erreur en H3Error. Le `message` (français, accents intacts) est conservé ;
 * `statusMessage` reste en ASCII (h3 en retire les autres caractères) : on y met le code.
 * Une erreur inconnue n'est jamais renvoyée telle quelle : journal sans donnée personnelle
 * (chemin et nom de classe seulement), réponse générique.
 */
function toH3Error(event: H3Event, error: unknown): H3Error {
  if (isError(error)) {
    return error
  }
  if (error instanceof DomainError) {
    if (error instanceof TooManyRequestsError) {
      // En-tête posé en chaîne (h3 type `Retry-After` en nombre, Node le renverrait tel quel).
      event.node.res.setHeader('Retry-After', String(error.retryAfter))
    }
    const h3Error = createError({
      statusCode: error.status,
      statusMessage: error.code,
      message: error.message,
      data: { code: error.code, ...error.data },
    })
    // Les erreurs métier ne divulguent jamais de stack (Nitro la sérialise en dev).
    h3Error.stack = ''
    return h3Error
  }
  console.error({ chemin: event.path, ...describeUnknown(error) })
  return createError({
    statusCode: 500,
    statusMessage: 'ERREUR_INTERNE',
    message: ERROR_MESSAGES.ERREUR_INTERNE,
    data: { code: 'ERREUR_INTERNE' },
  })
}

/** Enveloppe d'une route : à utiliser dans TOUTES les routes S2. */
export function defineApiHandler<T>(handler: (event: H3Event<EventHandlerRequest>) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      throw toH3Error(event, error)
    }
  })
}
