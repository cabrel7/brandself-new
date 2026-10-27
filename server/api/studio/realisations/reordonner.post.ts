import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toRealisationStudioResource, toRealisationsCompteursResource } from '#server/resources/realisation'
import { reorderRealisations } from '#server/services/realisations'
import { schemaRealisationReorder } from '#shared/schemas/realisation'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { ids } = await readBodyWith(event, schemaRealisationReorder)
  const { items, compteurs } = await reorderRealisations(user.id, ids)
  return {
    realisations: items.map(({ realisation, image, galerie }) => toRealisationStudioResource(realisation, image, galerie)),
    compteurs: toRealisationsCompteursResource(compteurs),
  }
})
