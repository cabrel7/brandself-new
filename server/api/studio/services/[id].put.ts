import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toServiceStudioResource, toServicesCompteursResource } from '#server/resources/service'
import { updateService } from '#server/services/services'
import { schemaServiceUpdate } from '#shared/schemas/service'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  const patch = await readBodyWith(event, schemaServiceUpdate)
  const { item, compteurs } = await updateService(user.id, id, patch)
  return { service: toServiceStudioResource(item.service, item.image), compteurs: toServicesCompteursResource(compteurs) }
})
