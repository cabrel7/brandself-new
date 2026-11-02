import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toLienStudioResource, toLiensCompteursResource } from '#server/resources/lien'
import { reorderLiens } from '#server/services/liens'
import { schemaLienReorder } from '#shared/schemas/lien'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { ids } = await readBodyWith(event, schemaLienReorder)
  const { items, compteurs } = await reorderLiens(user.id, ids)
  return {
    liens: items.map(toLienStudioResource),
    compteurs: toLiensCompteursResource(compteurs),
  }
})
