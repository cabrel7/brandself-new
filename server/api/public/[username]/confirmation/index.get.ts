import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { getConfirmationCookie } from '#server/utils/confirmation-cookie'
import { toReservationConfirmationResource } from '#server/resources/agenda'
import { getReservationConfirmation } from '#server/services/reservations'
import { NotFoundError } from '#server/exceptions/http'
import { schemaConfirmationToken, schemaPublicUsernameParams } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const parsed = schemaConfirmationToken.safeParse(getConfirmationCookie(event))
  if (!parsed.success) throw new NotFoundError('CONFIRMATION_RESERVATION_INVALIDE')
  const confirmation = await getReservationConfirmation(parsed.data, new Date(), username)
  return toReservationConfirmationResource(confirmation)
})
