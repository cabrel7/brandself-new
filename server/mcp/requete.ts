// S16 : conversion d'un événement h3 (Node) en éléments d'une Request Web, pour les bibliothèques
// (SDK MCP, Better Auth) qui travaillent en Request/Response.

import { getRequestURL } from 'h3'
import type { H3Event } from 'h3'

const ENTETES_NON_RECOPIES = new Set(['content-length', 'transfer-encoding'])

/** En-têtes de la requête entrante, sans ceux qui décrivent un corps (recalculés par `Request`). */
export function entetesDe(event: H3Event): Headers {
  const entetes = new Headers()
  for (const [nom, valeur] of Object.entries(event.node.req.headers)) {
    if (valeur === undefined || ENTETES_NON_RECOPIES.has(nom)) continue
    entetes.set(nom, Array.isArray(valeur) ? valeur.join(', ') : valeur)
  }
  return entetes
}

/** URL publique de la requête (hôte et protocole transmis par le reverse proxy). */
export function urlDe(event: H3Event): URL {
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
}
