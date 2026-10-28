import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toTemoignageStudioResource, toTemoignagesCompteursResource } from '#server/resources/temoignage'
import { reorderTemoignages } from '#server/services/temoignages'
import { schemaTemoignageReorder } from '#shared/schemas/temoignage'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { ids } = await readBodyWith(event, schemaTemoignageReorder)
  const { items, compteurs } = await reorderTemoignages(user.id, ids)
  return {
    temoignages: items.map(toTemoignageStudioResource),
    compteurs: toTemoignagesCompteursResource(compteurs),
  }
})
