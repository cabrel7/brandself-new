import { getQuery, getRequestHeader, readBody, setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { getClientIp } from '#server/utils/client-ip'
import { enforceLimit } from '#server/services/limiteur'
import {
  DESABONNEMENT_CORPS_MAX_OCTETS,
  DESABONNEMENT_ENTETES,
  pickUnsubscribeToken,
  unsubscribe,
  unsubscribeLimitKey,
} from '#server/services/desabonnement'
import { DESABONNEMENT_ACTION_LIMIT } from '#shared/limites'

// Corps JSON `{ jeton }` ou form-urlencoded `List-Unsubscribe=One-Click` (RFC 8058, jeton en query).
// Corps absent, trop gros, en morceaux (sans content-length) ou illisible : on retombe sur le jeton de la query
// (le jeton signé est l'autorisation). Sans jeton valide : 404 JETON_INVALIDE, jamais 400/500.
async function lireCorps(event: H3Event): Promise<unknown> {
  const taille = Number.parseInt(getRequestHeader(event, 'content-length') ?? '', 10)
  if (!Number.isInteger(taille) || taille <= 0 || taille > DESABONNEMENT_CORPS_MAX_OCTETS) return undefined
  try {
    return await readBody(event)
  } catch {
    return undefined
  }
}

// S9 §6 : POST = désabonnement effectif et idempotent. Sans session, sans CSRF : le jeton signé est
// l'autorisation et l'opération ne peut que désactiver. Limite IP fail-open.
export default defineApiHandler(async (event) => {
  setResponseHeaders(event, DESABONNEMENT_ENTETES)
  const { jeton: jetonQuery } = getQuery(event)
  // Le gestionnaire d'erreurs journalise `event.path` : sans la query string, le jeton n'y figure jamais.
  event._path = event.path.split('?')[0]
  await enforceLimit(unsubscribeLimitKey(getClientIp(event), 'action'), DESABONNEMENT_ACTION_LIMIT.limit, DESABONNEMENT_ACTION_LIMIT.windowS)
  const corps = await lireCorps(event)
  return unsubscribe(pickUnsubscribeToken(corps, jetonQuery), new Date())
})
