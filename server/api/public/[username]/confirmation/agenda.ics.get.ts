import { setResponseHeader, setResponseHeaders } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { getConfirmationCookie } from '#server/utils/confirmation-cookie'
import { NotFoundError } from '#server/exceptions/http'
import { buildReservationIcs } from '#server/services/agenda-ics'
import { getReservationConfirmation } from '#server/services/reservations'
import { schemaConfirmationToken, schemaPublicUsernameParams } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const parsed = schemaConfirmationToken.safeParse(getConfirmationCookie(event))
  if (!parsed.success) throw new NotFoundError('CONFIRMATION_RESERVATION_INVALIDE')
  const confirmation = await getReservationConfirmation(parsed.data, new Date(), username)
  const cancelled = confirmation.reservation.statut === 'annulee'
  const ics = buildReservationIcs({
    reservationId: confirmation.reservation.id,
    sequence: cancelled ? 1 : 0,
    method: cancelled ? 'CANCEL' : 'REQUEST',
    generatedAt: new Date(),
    debut: confirmation.reservation.debut,
    fin: confirmation.reservation.fin,
    serviceTitle: confirmation.service.titre,
    location: [confirmation.vitrine.metier, confirmation.vitrine.ville].filter(Boolean).join(', '),
  })
  setResponseHeaders(event, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="reservation-brandself.ics"',
  })
  return ics
})
