import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toTemoignageStudioResource, toTemoignagesCompteursResource } from '#server/resources/temoignage'
import { getOwnTemoignageBySlug } from '#server/services/temoignages'
import { schemaTemoignageParams } from '#shared/schemas/temoignage'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { slug } = readParamsWith(event, schemaTemoignageParams)
  const { item, compteurs } = await getOwnTemoignageBySlug(user.id, slug)
  return {
    temoignage: toTemoignageStudioResource(item),
    compteurs: toTemoignagesCompteursResource(compteurs),
  }
})
