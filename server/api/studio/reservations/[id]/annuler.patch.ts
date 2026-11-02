import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toReservationActionResource } from '#server/resources/agenda'
import { cancelReservation } from '#server/services/reservations'
import { schemaAgendaIdParams, schemaReservationCancel } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { id } = readParamsWith(event, schemaAgendaIdParams)
  const input = await readBodyWith(event, schemaReservationCancel)
  const { item } = await cancelReservation(user.id, id, input)
  return toReservationActionResource(item)
})
