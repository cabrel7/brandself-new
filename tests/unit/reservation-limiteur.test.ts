import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_MESSAGES, TooManyRequestsError } from '../../server/exceptions/http'

const { hitLimit } = vi.hoisted(() => ({
  hitLimit: vi.fn(),
}))

vi.mock('#server/services/limiteur', () => ({ hitLimit }))

const EXPECTED_LIMIT = 3
const EXPECTED_WINDOW_S = 86_400
const USERNAME = 'dr-cabrel'
const EMAIL = 'patient@example.com'
const TELEPHONE = '+237699000001'

const reservationLimiteurService = () => import('../../server/services/reservation-limiteur')

function allowedStatus(retryAfter = EXPECTED_WINDOW_S) {
  return {
    count: 1,
    limit: EXPECTED_LIMIT,
    allowed: true,
    retryAfter,
  }
}

async function keysFor(username: string, email: string, telephone: string): Promise<string[]> {
  const firstCall = hitLimit.mock.calls.length
  const { enforceReservationContactLimit } = await reservationLimiteurService()

  await enforceReservationContactLimit(username, email, telephone)

  const calls = hitLimit.mock.calls.slice(firstCall)
  expect(calls).toHaveLength(2)
  return calls.map((call) => {
    const key = call[0]
    if (typeof key !== 'string') throw new TypeError('La clé du limiteur doit être une chaîne.')
    return key
  }).sort()
}

function intersection(left: string[], right: string[]): string[] {
  return left.filter(key => right.includes(key))
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('La promesse devait être rejetée.')
}

beforeEach(() => {
  hitLimit.mockReset()
  hitLimit.mockResolvedValue(allowedStatus())
})

describe('reservation contact limiter', () => {
  it('should expose the exact contact limit contract', async () => {
    const { RESERVATION_CONTACT_LIMIT } = await import('../../shared/limites')

    expect(RESERVATION_CONTACT_LIMIT).toEqual({
      limit: EXPECTED_LIMIT,
      windowS: EXPECTED_WINDOW_S,
    })
  })

  it('should normalize email while keeping email and E.164 telephone counters independent', async () => {
    const canonicalKeys = await keysFor(USERNAME, EMAIL, TELEPHONE)
    const normalizedCollisionKeys = await keysFor(USERNAME, '  Patient@Example.COM  ', TELEPHONE)
    const otherEmailKeys = await keysFor(USERNAME, 'other@example.com', TELEPHONE)
    const otherTelephoneKeys = await keysFor(USERNAME, EMAIL, '+237699000002')

    expect(new Set(canonicalKeys)).toHaveLength(2)
    expect(normalizedCollisionKeys).toEqual(canonicalKeys)
    expect(intersection(canonicalKeys, otherEmailKeys)).toHaveLength(1)
    expect(intersection(canonicalKeys, otherTelephoneKeys)).toHaveLength(1)
  })

  it('should isolate identical contacts between usernames', async () => {
    const firstVitrineKeys = await keysFor('dr-cabrel', EMAIL, TELEPHONE)
    const secondVitrineKeys = await keysFor('cabinet-nord', EMAIL, TELEPHONE)

    expect(intersection(firstVitrineKeys, secondVitrineKeys)).toHaveLength(0)
  })

  it('should use versioned keys whose only dynamic value is a lowercase SHA-256 hex digest', async () => {
    const ip = '203.0.113.42'
    const username = 'cabinet-confidentiel'
    const email = `patient+${ip}@example.com`
    const telephone = '+237699123456'
    const keys = await keysFor(username, email, telephone)

    for (const key of keys) {
      const segments = key.split(':')
      expect(segments).toContain('v1')
      expect(segments.at(-1)).toMatch(/^[a-f0-9]{64}$/)
      expect(key).not.toContain(username)
      expect(key.toLowerCase()).not.toContain(email.toLowerCase())
      expect(key).not.toContain(telephone)
      expect(key).not.toContain(ip)
    }
  })

  it('should hit both counters with the exact limit and fail-closed option', async () => {
    const { enforceReservationContactLimit } = await reservationLimiteurService()

    await enforceReservationContactLimit(USERNAME, EMAIL, TELEPHONE)

    expect(hitLimit).toHaveBeenCalledTimes(2)
    for (const call of hitLimit.mock.calls) {
      expect(call[0]).toEqual(expect.any(String))
      expect(call[1]).toBe(EXPECTED_LIMIT)
      expect(call[2]).toBe(EXPECTED_WINDOW_S)
      expect(call[3]).toEqual({ failClosed: true })
    }
  })

  it('should increment both counters and throw one generic error with the greatest blocked retryAfter', async () => {
    hitLimit
      .mockResolvedValueOnce({ count: 4, limit: EXPECTED_LIMIT, allowed: false, retryAfter: 19 })
      .mockResolvedValueOnce({ count: 5, limit: EXPECTED_LIMIT, allowed: false, retryAfter: 47 })
    const { enforceReservationContactLimit } = await reservationLimiteurService()

    const error = await captureError(enforceReservationContactLimit(USERNAME, EMAIL, TELEPHONE))

    expect(hitLimit).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(TooManyRequestsError)
    if (!(error instanceof TooManyRequestsError)) throw new TypeError('TooManyRequestsError attendue.')
    expect(error.code).toBe('TROP_DE_REQUETES')
    expect(error.status).toBe(429)
    expect(error.message).toBe(ERROR_MESSAGES.TROP_DE_REQUETES)
    expect(error.retryAfter).toBe(47)
    expect(error.data).toEqual({ retryAfter: 47 })
    expect(error.message).not.toContain(EMAIL)
    expect(error.message).not.toContain(TELEPHONE)
    expect(error.message).not.toContain(USERNAME)
  })

  it('should ignore retryAfter from an allowed counter when only the other counter is blocked', async () => {
    hitLimit
      .mockResolvedValueOnce({ count: 4, limit: EXPECTED_LIMIT, allowed: false, retryAfter: 23 })
      .mockResolvedValueOnce({ count: 1, limit: EXPECTED_LIMIT, allowed: true, retryAfter: 999 })
    const { enforceReservationContactLimit } = await reservationLimiteurService()

    const error = await captureError(enforceReservationContactLimit(USERNAME, EMAIL, TELEPHONE))

    expect(error).toBeInstanceOf(TooManyRequestsError)
    if (!(error instanceof TooManyRequestsError)) throw new TypeError('TooManyRequestsError attendue.')
    expect(error.retryAfter).toBe(23)
  })
})
