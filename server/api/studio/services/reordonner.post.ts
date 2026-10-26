import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toServiceStudioResource, toServicesCompteursResource } from '#server/resources/service'
import { reorderServices } from '#server/services/services'
import { schemaServiceReorder } from '#shared/schemas/service'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { ids } = await readBodyWith(event, schemaServiceReorder)
  const { items, compteurs } = await reorderServices(user.id, ids)
  return {
    services: items.map(({ service, image }) => toServiceStudioResource(service, image)),
    compteurs: toServicesCompteursResource(compteurs),
  }
})
