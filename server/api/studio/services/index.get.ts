import { defineApiHandler } from '#server/utils/api'
import { toServiceStudioResource, toServicesCompteursResource } from '#server/resources/service'
import { listOwnServices } from '#server/services/services'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items, compteurs } = await listOwnServices(user.id)
  return {
    services: items.map(({ service, image }) => toServiceStudioResource(service, image)),
    compteurs: toServicesCompteursResource(compteurs),
  }
})
