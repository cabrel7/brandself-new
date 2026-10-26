import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toServiceStudioResource, toServicesCompteursResource } from '#server/resources/service'
import { createService } from '#server/services/services'
import { schemaServiceCreate } from '#shared/schemas/service'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaServiceCreate)
  const { item, compteurs } = await createService(user.id, input)
  setResponseStatus(event, 201)
  return { service: toServiceStudioResource(item.service, item.image), compteurs: toServicesCompteursResource(compteurs) }
})
