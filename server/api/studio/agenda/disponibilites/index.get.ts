import { defineApiHandler } from '#server/utils/api'
import { toAgendaStudioResource } from '#server/resources/agenda'
import { getOwnAgenda } from '#server/services/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const resource = toAgendaStudioResource(await getOwnAgenda(user.id))
  return { items: resource.disponibilites, reglages: resource.reglages }
})
