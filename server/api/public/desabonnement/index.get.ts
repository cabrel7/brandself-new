import { getQuery, setResponseHeaders } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { getClientIp } from '#server/utils/client-ip'
import { enforceLimit } from '#server/services/limiteur'
import { DESABONNEMENT_ENTETES, previewUnsubscribe, unsubscribeLimitKey } from '#server/services/desabonnement'
import { DESABONNEMENT_APERCU_LIMIT } from '#shared/limites'

// S9 §6 : GET sans effet (les scanners de liens des messageries l'ouvrent). Ordre : en-têtes → limite IP
// (fail-open : le droit d'opposition reste effectif sans Redis) → service. Le jeton n'est validé que par le
// service (toute forme inutilisable = 404 JETON_INVALIDE, jamais 400).
export default defineApiHandler(async (event) => {
  setResponseHeaders(event, DESABONNEMENT_ENTETES)
  const { jeton } = getQuery(event)
  // Le gestionnaire d'erreurs journalise `event.path` : sans la query string, le jeton n'y figure jamais.
  event._path = event.path.split('?')[0]
  await enforceLimit(unsubscribeLimitKey(getClientIp(event), 'apercu'), DESABONNEMENT_APERCU_LIMIT.limit, DESABONNEMENT_APERCU_LIMIT.windowS)
  return previewUnsubscribe(jeton, new Date())
})
