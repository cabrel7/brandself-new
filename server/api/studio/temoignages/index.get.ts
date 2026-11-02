import { defineApiHandler } from '#server/utils/api'
import { toTemoignageStudioResource, toTemoignagesCompteursResource } from '#server/resources/temoignage'
import { listOwnTemoignages } from '#server/services/temoignages'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items, compteurs } = await listOwnTemoignages(user.id)
  return {
    temoignages: items.map(toTemoignageStudioResource),
    compteurs: toTemoignagesCompteursResource(compteurs),
  }
})
