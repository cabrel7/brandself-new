import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toDemandeActionResource } from '#server/resources/agenda'
import { updateDemande } from '#server/services/demandes'
import { schemaAgendaIdParams, schemaDemandeUpdate } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaAgendaIdParams)
  const input = await readBodyWith(event, schemaDemandeUpdate)
  const { item } = await updateDemande(user.id, id, input)
  return toDemandeActionResource(item)
})
