import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toReservationActionResource } from '#server/resources/agenda'
import { refuseReservation } from '#server/services/reservations'
import { schemaAgendaIdParams } from '#shared/schemas/agenda'

// S7-bis §4.3 : refus d'une réservation en attente, sans motif (corps vide) ;
// `refusee` est terminal et libère le créneau (jamais dans les statuts bloquants).
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaAgendaIdParams)
  const { item } = await refuseReservation(user.id, id)
  return toReservationActionResource(item)
})
