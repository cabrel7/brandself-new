import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toLienStudioResource, toLiensCompteursResource } from '#server/resources/lien'
import { createLien } from '#server/services/liens'
import { schemaLienCreate } from '#shared/schemas/lien'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaLienCreate)
  const { item, compteurs } = await createLien(user.id, input)
  setResponseStatus(event, 201)
  return { lien: toLienStudioResource(item), compteurs: toLiensCompteursResource(compteurs) }
})
