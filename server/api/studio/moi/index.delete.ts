import { sendNoContent } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { deleteAccount } from '#server/services/utilisateurs'
import { schemaAccountDeletion } from '#shared/schemas/moi'

export default defineApiHandler(async (event) => {
  const { user, session } = await requireUserSession(event)
  const { confirmation } = await readBodyWith(event, schemaAccountDeletion)
  await deleteAccount(user.id, { confirmation, sessionCreatedAt: new Date(session.createdAt) })
  return sendNoContent(event)
})
