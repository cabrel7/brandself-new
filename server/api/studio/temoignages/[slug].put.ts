import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toTemoignageStudioResource, toTemoignagesCompteursResource } from '#server/resources/temoignage'
import { updateTemoignageBySlug } from '#server/services/temoignages'
import { schemaTemoignageParams, schemaTemoignageUpdate } from '#shared/schemas/temoignage'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { slug } = readParamsWith(event, schemaTemoignageParams)
  const patch = await readBodyWith(event, schemaTemoignageUpdate)
  const { item, compteurs } = await updateTemoignageBySlug(user.id, slug, patch)
  return {
    temoignage: toTemoignageStudioResource(item),
    compteurs: toTemoignagesCompteursResource(compteurs),
  }
})
