import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { toReferentiels } from '#server/resources/admin-a5'
import { lireReferentiels } from '#server/services/configuration/catalogues'
import { REFERENTIELS_CACHE_S } from '#shared/admin'

// Lecture PUBLIQUE (D-A5-15) : pays actifs (indicatif, fuseaux, canaux effectifs) et devises actives. Aucune donnée
// d'administration. Cache 60 s.
export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', `public, max-age=${REFERENTIELS_CACHE_S}`)
  return toReferentiels(await lireReferentiels())
})
