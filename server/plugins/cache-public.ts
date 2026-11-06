// S12 (#138) : microcache HTML via Nitro. Pose X-Accel-Expires (nginx lit cet en-tête)
// et Cache-Control: no-cache sur les pages publiques de la liste blanche, jamais sur
// une réponse qui pose Set-Cookie, ni sur une requête avec cookie de session.
import { appendHeader, setHeader } from 'h3'
import type { H3Event } from 'h3'
import { CACHE_HTML_TTL_S, estRouteCacheable } from '../../shared/seo'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event: H3Event) => {
    const { method, path, node } = event
    const res = node.res
    if (method !== 'GET' && method !== 'HEAD') return
    if (!estRouteCacheable(path)) return
    if (res.statusCode !== 200) return
    // Aucune mise en cache si la réponse pose déjà un Set-Cookie (état utilisateur).
    const headers = res.getHeaders ? res.getHeaders() : {}
    const setCookie = headers['set-cookie']
    if (setCookie) return
    // Ne pas écraser un Cache-Control explicite déjà posé (ex. private, no-store).
    if (headers['cache-control']) return

    setHeader(event, 'Cache-Control', 'no-cache')
    appendHeader(event, 'X-Accel-Expires', String(CACHE_HTML_TTL_S))

    // En-têtes de sécurité de base s'ils sont absents.
    if (!headers['x-content-type-options']) {
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
    }
    if (!headers['referrer-policy']) {
      setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
    }
  })
})
