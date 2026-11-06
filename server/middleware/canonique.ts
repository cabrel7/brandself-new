// S12 (#146) : redirection canonique 301 pour la casse et la barre finale des pages publiques.
// Ne s'applique qu'aux GET/HEAD. Jamais sur /api, /_nuxt, /medias, /studio, /connexion, /onboarding.
import { defineEventHandler, sendRedirect } from 'h3'
import type { H3Event } from 'h3'
import { cheminCanonique } from '../../shared/seo'
import { isReserved } from '../../shared/reserved'

const SEGMENTS_EXCLUS = ['api', '_nuxt', 'medias', '__', 'studio', 'connexion', 'onboarding']

export default defineEventHandler((event: H3Event): void => {
  // `event.path`/`event.method` viennent de h3. `event.node.req.path` n'existe pas
  // (API Express) : il serait `undefined` et chaque GET/HEAD échouerait en 500.
  const { method, path } = event
  if (method !== 'GET' && method !== 'HEAD') return

  const interrogation = path.indexOf('?')
  const chemin = interrogation === -1 ? path : path.slice(0, interrogation)
  const segments = chemin.split('/').filter((s) => s.length > 0)
  const [premier] = segments

  // Exclusions : routes techniques, fichiers (point dans le dernier segment), studio, connexion, onboarding.
  if (!premier) return
  if (SEGMENTS_EXCLUS.includes(premier.toLowerCase())) return
  if (segments[segments.length - 1]?.includes('.')) return
  if (isReserved(premier.toLowerCase())) return

  const canonique = cheminCanonique(chemin)
  if (canonique === null) return

  // Conserve la query string.
  const query = interrogation === -1 ? '' : path.slice(interrogation)
  void sendRedirect(event, `${canonique}${query}`, 301)
})
