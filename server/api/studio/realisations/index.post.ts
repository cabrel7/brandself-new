import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toRealisationStudioResource, toRealisationsCompteursResource } from '#server/resources/realisation'
import { createRealisation } from '#server/services/realisations'
import { schemaRealisationCreate } from '#shared/schemas/realisation'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaRealisationCreate)
  const { item, compteurs } = await createRealisation(user.id, input)
  setResponseStatus(event, 201)
  return {
    realisation: toRealisationStudioResource(item.realisation, item.image, item.galerie),
    compteurs: toRealisationsCompteursResource(compteurs),
  }
})
