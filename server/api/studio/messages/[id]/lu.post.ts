import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toMessageLuResource } from '#server/resources/message'
import { markMessageLu } from '#server/services/messages'
import { schemaMessageIdParams } from '#shared/schemas/message'

// S7-bis §4.7 : corps vide (aucun contenu accepté) ; le marquage est idempotent,
// le service ne change jamais une date de lecture existante.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaMessageIdParams)
  const { item } = await markMessageLu(user.id, id)
  return toMessageLuResource(item)
})
