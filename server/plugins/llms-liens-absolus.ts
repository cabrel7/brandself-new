// Liens absolus dans /llms.txt (et /llms/*.txt) : voir `absolutiserLiensLlms` (shared/seo.ts).
// Le gabarit du module écrit tel quel les `href` de `LLMS_SECTIONS` ; on les complète ici avec l'URL publique
// configurée, au moment de la réponse (jamais d'hôte écrit dans le code ni dans l'image).
import { env } from '../../shared/env'
import { absolutiserLiensLlms } from '../../shared/seo'

const CHEMIN_LLMS = /^\/llms(\.txt|\/[^/]+\.txt)$/i

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return
    const chemin = event.path.split('?', 1)[0] ?? ''
    if (!CHEMIN_LLMS.test(chemin) || typeof response.body !== 'string') return
    const siteUrl = env.NUXT_PUBLIC_SITE_URL
    if (!siteUrl) return
    response.body = absolutiserLiensLlms(response.body, siteUrl)
  })
})
