import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toLienStudioResource } from '#server/resources/lien'
import { getOwnLien } from '#server/services/liens'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  const { item } = await getOwnLien(user.id, id)
  return { lien: toLienStudioResource(item) }
})
