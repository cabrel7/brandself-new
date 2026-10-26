import { sendNoContent } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { deleteService } from '#server/services/services'

const schemaParams = z.object({ id: z.uuid() })

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  await deleteService(user.id, id)
  return sendNoContent(event)
})
