import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooManyRequestsError } from '../../server/exceptions/http'
import { fakeEvent } from '../support/h3'

const {
  createReservation,
  enforceLimit,
  enforceReservationContactLimit,
  setConfirmationCookie,
} = vi.hoisted(() => ({
  createReservation: vi.fn(),
  enforceLimit: vi.fn(),
  enforceReservationContactLimit: vi.fn(),
  setConfirmationCookie: vi.fn(),
}))

vi.mock('#server/services/reservations', () => ({ createReservation }))
vi.mock('#server/services/limiteur', () => ({ enforceLimit }))
vi.mock('#server/services/reservation-limiteur', () => ({ enforceReservationContactLimit }))
vi.mock('#server/utils/confirmation-cookie', () => ({ setConfirmationCookie }))
vi.mock('#server/resources/agenda', () => ({
  toReservationCreatedResource: (result: { item: { id: string, statut: string } }) => ({ reservation: result.item }),
}))

const routeReservation = () => import('../../server/api/public/[username]/reservations/index.post')

const CLIENT_IP = '198.51.100.24'
const USERNAME = 'dr-cabrel'
const EMAIL = 'patient@example.com'
const TELEPHONE = '+237699000001'
const CONFIRMATION_TOKEN = 'opaque-confirmation-token'
const VALID_BODY = {
  serviceId: '11111111-1111-4111-8111-111111111111',
  debut: '2026-11-15T09:00:00+01:00',
  nom: 'Ariane Mballa',
  email: EMAIL,
  telephone: TELEPHONE,
  siteWeb: '',
  motif: 'Première visite',
  rappelEmail: true,
  paiementChoisi: 'sur_place',
}

function reservationEvent(body: string = JSON.stringify(VALID_BODY)) {
  const event = fakeEvent({
    method: 'POST',
    params: { username: USERNAME },
    body,
  })
  Object.defineProperty(event.node.req.socket, 'remoteAddress', {
    configurable: true,
    value: CLIENT_IP,
  })
  return event
}

beforeEach(() => {
  vi.resetAllMocks()
  enforceLimit.mockResolvedValue(undefined)
  enforceReservationContactLimit.mockResolvedValue(undefined)
  createReservation.mockResolvedValue({
    item: { id: '22222222-2222-4222-8222-222222222222', statut: 'en_attente' },
    confirmation: { token: CONFIRMATION_TOKEN },
  })
})

describe('POST public reservations', () => {
  it('should enforce the IP limit before reading the body', async () => {
    enforceLimit.mockRejectedValueOnce(new TooManyRequestsError(61))
    const { default: handler } = await routeReservation()
    const event = reservationEvent('{"email":')

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 429,
      data: { code: 'TROP_DE_REQUETES', retryAfter: 61 },
    })
    expect(enforceLimit).toHaveBeenCalledWith(
      `reservation-publique:${CLIENT_IP}`,
      expect.any(Number),
      expect.any(Number),
      { failClosed: true },
    )
    expect(enforceReservationContactLimit).not.toHaveBeenCalled()
    expect(createReservation).not.toHaveBeenCalled()
    expect(setConfirmationCookie).not.toHaveBeenCalled()
  })

  it('should validate the body before enforcing the contact limit', async () => {
    const { default: handler } = await routeReservation()
    const event = reservationEvent(JSON.stringify({ ...VALID_BODY, email: 'adresse-invalide' }))

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(enforceLimit).toHaveBeenCalledOnce()
    expect(enforceReservationContactLimit).not.toHaveBeenCalled()
    expect(createReservation).not.toHaveBeenCalled()
    expect(setConfirmationCookie).not.toHaveBeenCalled()
  })

  it('should enforce the contact limit with validated data after IP and before creation', async () => {
    const { default: handler } = await routeReservation()
    const event = reservationEvent()

    await expect(handler(event)).resolves.toEqual({
      reservation: { id: '22222222-2222-4222-8222-222222222222', statut: 'en_attente' },
    })

    expect(enforceReservationContactLimit).toHaveBeenCalledOnce()
    expect(enforceReservationContactLimit).toHaveBeenCalledWith(USERNAME, EMAIL, TELEPHONE)
    expect(enforceLimit.mock.invocationCallOrder[0]).toBeLessThan(
      enforceReservationContactLimit.mock.invocationCallOrder[0],
    )
    expect(enforceReservationContactLimit.mock.invocationCallOrder[0]).toBeLessThan(
      createReservation.mock.invocationCallOrder[0],
    )
    expect(setConfirmationCookie).toHaveBeenCalledWith(event, USERNAME, CONFIRMATION_TOKEN)
    expect(event.node.res.statusCode).toBe(201)
  })

  it('should not create a reservation or cookie when the contact limit rejects the request', async () => {
    enforceReservationContactLimit.mockRejectedValueOnce(new TooManyRequestsError(83))
    const { default: handler } = await routeReservation()
    const event = reservationEvent()

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 429,
      data: { code: 'TROP_DE_REQUETES', retryAfter: 83 },
    })

    expect(enforceLimit).toHaveBeenCalledOnce()
    expect(enforceReservationContactLimit).toHaveBeenCalledWith(USERNAME, EMAIL, TELEPHONE)
    expect(createReservation).not.toHaveBeenCalled()
    expect(setConfirmationCookie).not.toHaveBeenCalled()
    expect(event.node.res.getHeader('Retry-After')).toBe('83')
  })
})
