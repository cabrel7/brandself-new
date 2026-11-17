import { defineApiHandler } from '#server/utils/api'
import { toEntreeJournalResource } from '#server/resources/assistant'
import { listJournalAssistant } from '#server/services/assistants'

// S16 : les 50 dernières actions des assistants sur la vitrine de l'utilisateur.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const entrees = await listJournalAssistant(user.id)
  return { entrees: entrees.map(toEntreeJournalResource) }
})
