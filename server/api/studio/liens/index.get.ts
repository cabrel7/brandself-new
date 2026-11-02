import { defineApiHandler } from '#server/utils/api'
import { toLienStudioResource, toLiensCompteursResource } from '#server/resources/lien'
import { listOwnLiens } from '#server/services/liens'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items, compteurs } = await listOwnLiens(user.id)
  return {
    liens: items.map(toLienStudioResource),
    compteurs: toLiensCompteursResource(compteurs),
  }
})
