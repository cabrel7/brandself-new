import { defineApiHandler } from '#server/utils/api'
import { toReservationStudioResource } from '#server/resources/agenda'
import { listOwnReservations } from '#server/services/reservations'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items } = await listOwnReservations(user.id)
  return { items: items.map(toReservationStudioResource) }
})
