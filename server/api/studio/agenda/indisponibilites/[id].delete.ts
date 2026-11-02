import { sendNoContent } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { deleteIndisponibilite } from '#server/services/agenda'
import { schemaAgendaIdParams } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaAgendaIdParams)
  await deleteIndisponibilite(user.id, id)
  return sendNoContent(event)
})
