import { defineApiHandler } from '#server/utils/api'
import { toRealisationStudioResource, toRealisationsCompteursResource } from '#server/resources/realisation'
import { listOwnRealisations } from '#server/services/realisations'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items, compteurs } = await listOwnRealisations(user.id)
  return {
    realisations: items.map(({ realisation, image, galerie }) => toRealisationStudioResource(realisation, image, galerie)),
    compteurs: toRealisationsCompteursResource(compteurs),
  }
})
