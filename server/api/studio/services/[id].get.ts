import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toServiceStudioResource, toServicesCompteursResource } from '#server/resources/service'
import { getOwnService } from '#server/services/services'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  const { item, compteurs } = await getOwnService(user.id, id)
  return { service: toServiceStudioResource(item.service, item.image), compteurs: toServicesCompteursResource(compteurs) }
})
