import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toReservationActionResource } from '#server/resources/agenda'
import { confirmReservation } from '#server/services/reservations'
import { schemaAgendaIdParams } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaAgendaIdParams)
  const { item } = await confirmReservation(user.id, id)
  return toReservationActionResource(item)
})
