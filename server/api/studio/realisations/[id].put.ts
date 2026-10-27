import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toRealisationStudioResource, toRealisationsCompteursResource } from '#server/resources/realisation'
import { updateRealisation } from '#server/services/realisations'
import { schemaRealisationUpdate } from '#shared/schemas/realisation'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  const patch = await readBodyWith(event, schemaRealisationUpdate)
  const { item, compteurs } = await updateRealisation(user.id, id, patch)
  return {
    realisation: toRealisationStudioResource(item.realisation, item.image, item.galerie),
    compteurs: toRealisationsCompteursResource(compteurs),
  }
})
