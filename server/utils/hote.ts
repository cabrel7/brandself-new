// A1 : logique d'hôte commune au plugin Nitro (`server/plugins/hote-admin.ts`, avant le service des fichiers statiques)
// et au middleware (`server/middleware/00-hote.ts`, défense en profondeur). L'hôte vient de l'en-tête `Host`
// (Nginx pose `Host $host`), JAMAIS de `X-Forwarded-Host` (falsifiable).
import { setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'
import { decisionHote, estHoteAdmin } from '../../shared/admin'
import { env } from '../../shared/env'

/** Ressources statiques de l'application : mises en cache normalement (jamais de donnée de compte). */
const PREFIXES_STATIQUES = ['/_nuxt/', '/_fonts/', '/brand/']

export interface VerdictHote {
  hoteAdmin: boolean
  refuser: boolean
}

export function evaluerHote(event: H3Event): VerdictHote {
  const hoteAdmin = estHoteAdmin(event.node.req.headers.host, env.ADMIN_HOST)
  return { hoteAdmin, refuser: decisionHote(event.path, hoteAdmin, import.meta.dev) === 'refuser' }
}

/** En-têtes de l'hôte d'administration : posés avant la décision, un 404 n'est ni indexable ni mis en cache. */
export function poserEntetesAdmin(event: H3Event): void {
  const statique = PREFIXES_STATIQUES.some((prefixe) => event.path.startsWith(prefixe))
  setResponseHeaders(event, {
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...(statique ? {} : { 'Cache-Control': 'no-store' }),
  })
}
