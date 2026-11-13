import { defineApiHandler } from '#server/utils/api'
import { countAgendaATraiter } from '#server/services/agenda-a-traiter'
import type { AgendaATraiterDTO } from '#shared/dto/agenda-a-traiter'

export default defineApiHandler(async (event): Promise<AgendaATraiterDTO> => {
  const { user } = await requireUserSession(event)
  return { nombre: await countAgendaATraiter(user.id) }
})
