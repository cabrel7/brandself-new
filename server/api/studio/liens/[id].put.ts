import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toLienStudioResource, toLiensCompteursResource } from '#server/resources/lien'
import { updateLien } from '#server/services/liens'
import { schemaLienUpdate } from '#shared/schemas/lien'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  const patch = await readBodyWith(event, schemaLienUpdate)
  const { item, compteurs } = await updateLien(user.id, id, patch)
  return { lien: toLienStudioResource(item), compteurs: toLiensCompteursResource(compteurs) }
})
