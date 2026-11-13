import { sendNoContent } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { revokeAssistant } from '#server/services/assistants'

// Les identifiants de consentement sont générés par Better Auth (pas des uuid).
const schemaParams = z.object({ id: z.string().min(1).max(128) })

// S16 : révoque un assistant (consentement et jetons).
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaParams)
  await revokeAssistant(user.id, id)
  return sendNoContent(event)
})
