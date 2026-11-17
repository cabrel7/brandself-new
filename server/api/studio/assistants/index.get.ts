import { defineApiHandler } from '#server/utils/api'
import { toAssistantsResource } from '#server/resources/assistant'
import { getAssistantsView } from '#server/services/assistants'

// S16 : adresse du serveur MCP, état (activé, plan payant) et assistants connectés de l'utilisateur.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  return toAssistantsResource(await getAssistantsView(user.id))
})
