import { sendNoContent } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { revokeDevice } from '#server/services/utilisateurs'

// Les identifiants de session sont générés par Better Auth (pas des uuid).
const schemaParams = z.object({ id: z.string().min(1).max(128) })

export default defineApiHandler(async (event) => {
  const { user, session } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  await revokeDevice(user.id, id, session.id)
  return sendNoContent(event)
})
