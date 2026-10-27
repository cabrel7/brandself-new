import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toRealisationStudioResource, toRealisationsCompteursResource } from '#server/resources/realisation'
import { getOwnRealisation } from '#server/services/realisations'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  const { item, compteurs } = await getOwnRealisation(user.id, id)
  return {
    realisation: toRealisationStudioResource(item.realisation, item.image, item.galerie),
    compteurs: toRealisationsCompteursResource(compteurs),
  }
})
