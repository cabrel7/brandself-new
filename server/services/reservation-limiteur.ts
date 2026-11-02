import { createHash } from 'node:crypto'
import { RESERVATION_CONTACT_LIMIT } from '../../shared/limites'
import { TooManyRequestsError } from '../exceptions/http'
import { hitLimit } from './limiteur'

const KEY_NAMESPACE = 'reservation-contact'
const KEY_VERSION = 'v1'

type ContactDimension = 'email' | 'telephone'

function contactLimitKey(username: string, dimension: ContactDimension, value: string): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([KEY_NAMESPACE, KEY_VERSION, username, dimension, value]))
    .digest('hex')
  return `${KEY_NAMESPACE}:${KEY_VERSION}:${fingerprint}`
}

export async function enforceReservationContactLimit(
  username: string,
  email: string,
  telephone: string,
): Promise<void> {
  const normalizedUsername = username.trim().toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()
  const { limit, windowS } = RESERVATION_CONTACT_LIMIT
  const options = { failClosed: true } as const

  const statuses = await Promise.all([
    hitLimit(contactLimitKey(normalizedUsername, 'email', normalizedEmail), limit, windowS, options),
    hitLimit(contactLimitKey(normalizedUsername, 'telephone', telephone), limit, windowS, options),
  ])
  const blockedStatuses = statuses.filter(status => !status.allowed)

  if (blockedStatuses.length > 0) {
    throw new TooManyRequestsError(Math.max(...blockedStatuses.map(status => status.retryAfter)))
  }
}
