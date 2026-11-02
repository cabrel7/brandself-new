import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { getClientIp } from '#server/utils/client-ip'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { setConfirmationCookie } from '#server/utils/confirmation-cookie'
import { toReservationCreatedResource } from '#server/resources/agenda'
import { enforceLimit } from '#server/services/limiteur'
import { enforceReservationContactLimit } from '#server/services/reservation-limiteur'
import { createReservation } from '#server/services/reservations'
import { RESERVATION_PUBLIC_LIMIT } from '#shared/limites'
import { schemaPublicUsernameParams, schemaReservationCreate } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  const ip = getClientIp(event)
  await enforceLimit(`reservation-publique:${ip}`, RESERVATION_PUBLIC_LIMIT.limit, RESERVATION_PUBLIC_LIMIT.windowS, {
    failClosed: true,
  })
  const input = await readBodyWith(event, schemaReservationCreate)
  await enforceReservationContactLimit(username, input.email, input.telephone)
  const result = await createReservation(username, {
    serviceId: input.serviceId,
    debut: input.debut,
    nom: input.nom,
    email: input.email,
    telephone: input.telephone,
    note: input.motif,
    paiementChoisi: input.paiementChoisi,
    rappelEmail: input.rappelEmail,
  })
  setConfirmationCookie(event, username, result.confirmation.token)
  setResponseStatus(event, 201)
  return toReservationCreatedResource(result)
})
