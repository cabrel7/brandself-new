import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toTemoignageStudioResource, toTemoignagesCompteursResource } from '#server/resources/temoignage'
import { createTemoignage } from '#server/services/temoignages'
import { schemaTemoignageCreate } from '#shared/schemas/temoignage'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaTemoignageCreate)
  const { item, compteurs } = await createTemoignage(user.id, input)
  return {
    temoignage: toTemoignageStudioResource(item),
    compteurs: toTemoignagesCompteursResource(compteurs),
  }
})
