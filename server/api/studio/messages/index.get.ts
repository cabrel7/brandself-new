import { defineApiHandler } from '#server/utils/api'
import { toMessagesStudioResource } from '#server/resources/message'
import { listOwnMessages } from '#server/services/messages'

// S7-bis §4.6 : liste des messages de la vitrine de l'utilisateur, plus récents d'abord,
// avec le compteur de non lus. Une vitrine absente = 404 VITRINE_INTROUVABLE (service).
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const liste = await listOwnMessages(user.id)
  return toMessagesStudioResource(liste)
})
