import { createHash } from 'node:crypto'
import { MESSAGE_CONTACT_LIMIT } from '../../shared/limites'
import { TooManyRequestsError } from '../exceptions/http'
import { hitLimit } from './limiteur'

// S7-bis §4.5 : mutualisation de la mécanique de `reservation-limiteur.ts` (conservé tel quel)
// pour tout formulaire public à contact : clés versionnées dont la partie dynamique est un
// SHA-256 (aucune donnée personnelle en clair dans Redis), compteurs fail-closed.
// Un téléphone absent (null) ne produit qu'un compteur (email) : hacher un `null` créerait
// un compteur partagé par tous les visiteurs sans téléphone de la vitrine.

const KEY_VERSION = 'v1'

type ContactDimension = 'email' | 'telephone'

function contactLimitKey(namespace: string, username: string, dimension: ContactDimension, value: string): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([namespace, KEY_VERSION, username, dimension, value]))
    .digest('hex')
  return `${namespace}:${KEY_VERSION}:${fingerprint}`
}

export async function enforceContactLimit(
  namespace: string,
  username: string,
  email: string,
  telephone: string | null,
): Promise<void> {
  const normalizedUsername = username.trim().toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()
  const { limit, windowS } = MESSAGE_CONTACT_LIMIT
  const options = { failClosed: true } as const

  const cles = [
    contactLimitKey(namespace, normalizedUsername, 'email', normalizedEmail),
    ...(telephone === null ? [] : [contactLimitKey(namespace, normalizedUsername, 'telephone', telephone)]),
  ]
  const statuses = await Promise.all(cles.map((cle) => hitLimit(cle, limit, windowS, options)))
  const blockedStatuses = statuses.filter((status) => !status.allowed)

  if (blockedStatuses.length > 0) {
    throw new TooManyRequestsError(Math.max(...blockedStatuses.map((status) => status.retryAfter)))
  }
}
