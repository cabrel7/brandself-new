import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_MESSAGES, TooManyRequestsError } from '../../server/exceptions/http'
import { MESSAGE_CONTACT_LIMIT, MESSAGE_PUBLIC_LIMIT } from '../../shared/limites'

// Contrat S7-bis §4.5 : `enforceContactLimit(namespace, username, email, telephone: string | null)`
// mutualise la mécanique SHA-256 fail-closed de `reservation-limiteur.ts` :
// clés versionnées hachées sans données en clair, deux compteurs (email, téléphone),
// MESSAGE_CONTACT_LIMIT { limit: 3, windowS: 86400 }.
// Design imposé au backend : téléphone null = une seule empreinte (email). Hacher un
// `null` créerait un compteur partagé par TOUS les visiteurs sans téléphone d'une vitrine.

const { hitLimit } = vi.hoisted(() => ({
  hitLimit: vi.fn(),
}))

vi.mock('#server/services/limiteur', () => ({ hitLimit }))

const CONTACT_LIMITEUR = () => import('../../server/services/contact-limiteur')

const NAMESPACE = 'message-contact'
const USERNAME = 'dr-cabrel'
const EMAIL = 'patient@example.com'
const TELEPHONE = '+237699000001'

function statutAutorise() {
  return { count: 1, limit: MESSAGE_CONTACT_LIMIT.limit, allowed: true, retryAfter: MESSAGE_CONTACT_LIMIT.windowS }
}

async function clesDe(
  namespace: string,
  username: string,
  email: string,
  telephone: string | null,
): Promise<string[]> {
  const premierAppel = hitLimit.mock.calls.length
  const { enforceContactLimit } = await CONTACT_LIMITEUR()

  await enforceContactLimit(namespace, username, email, telephone)

  const appels = hitLimit.mock.calls.slice(premierAppel)
  return appels.map((appel) => {
    const cle = appel[0]
    if (typeof cle !== 'string') throw new TypeError('La clé du limiteur doit être une chaîne.')
    return cle
  }).sort()
}

function intersection(gauche: string[], droite: string[]): string[] {
  return gauche.filter((cle) => droite.includes(cle))
}

async function captureEchec(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse
  } catch (erreur) {
    return erreur
  }
  throw new Error('La promesse devait être rejetée.')
}

beforeEach(() => {
  hitLimit.mockReset()
  hitLimit.mockResolvedValue(statutAutorise())
})

describe('limites de messages (shared/limites)', () => {
  it('expose le contrat exact MESSAGE_CONTACT_LIMIT (3 / 24 h par contact)', () => {
    expect(MESSAGE_CONTACT_LIMIT).toEqual({ limit: 3, windowS: 86_400 })
  })

  it('expose le contrat exact MESSAGE_PUBLIC_LIMIT (5 / 600 s par IP)', () => {
    expect(MESSAGE_PUBLIC_LIMIT).toEqual({ limit: 5, windowS: 600 })
  })
})

describe('enforceContactLimit', () => {
  it('interroge les deux compteurs (email, téléphone) avec la limite et le fail-closed exacts', async () => {
    const { enforceContactLimit } = await CONTACT_LIMITEUR()

    await enforceContactLimit(NAMESPACE, USERNAME, EMAIL, TELEPHONE)

    expect(hitLimit).toHaveBeenCalledTimes(2)
    for (const appel of hitLimit.mock.calls) {
      expect(appel[0]).toEqual(expect.any(String))
      expect(appel[1]).toBe(MESSAGE_CONTACT_LIMIT.limit)
      expect(appel[2]).toBe(MESSAGE_CONTACT_LIMIT.windowS)
      expect(appel[3]).toEqual({ failClosed: true })
    }
  })

  it('normalise email (casse/espaces) tout en gardant les empreintes email et téléphone indépendantes', async () => {
    const clesCanoniques = await clesDe(NAMESPACE, USERNAME, EMAIL, TELEPHONE)
    const clesCollision = await clesDe(NAMESPACE, USERNAME, '  Patient@Example.COM  ', TELEPHONE)
    const clesAutreEmail = await clesDe(NAMESPACE, USERNAME, 'autre@example.com', TELEPHONE)
    const clesAutreTelephone = await clesDe(NAMESPACE, USERNAME, EMAIL, '+237699000002')

    expect(new Set(clesCanoniques)).toHaveLength(2)
    expect(clesCollision).toEqual(clesCanoniques)
    expect(intersection(clesCanoniques, clesAutreEmail)).toHaveLength(1)
    expect(intersection(clesCanoniques, clesAutreTelephone)).toHaveLength(1)
  })

  it('normalise le username : deux casses d’un même username partagent leurs compteurs', async () => {
    const clesMinuscules = await clesDe(NAMESPACE, 'dr-cabrel', EMAIL, TELEPHONE)
    const clesMajuscules = await clesDe(NAMESPACE, '  Dr-Cabrel  ', EMAIL, TELEPHONE)

    expect(clesMajuscules).toEqual(clesMinuscules)
  })

  it('sépare les contacts identiques entre vitrines', async () => {
    const clesA = await clesDe(NAMESPACE, 'dr-cabrel', EMAIL, TELEPHONE)
    const clesB = await clesDe(NAMESPACE, 'cabinet-nord', EMAIL, TELEPHONE)

    expect(intersection(clesA, clesB)).toHaveLength(0)
  })

  it('séparé les espaces de nommage : deux namespaces ne partagent aucune empreinte', async () => {
    const clesMessages = await clesDe(NAMESPACE, USERNAME, EMAIL, TELEPHONE)
    const clesAutreEspace = await clesDe('autre-espace:v2', USERNAME, EMAIL, TELEPHONE)

    expect(intersection(clesMessages, clesAutreEspace)).toHaveLength(0)
  })

  it('utilise des clés versionnées dont la seule partie dynamique est un SHA-256 hexadécimal', async () => {
    const cles = await clesDe(NAMESPACE, 'cabinet-confidentiel', EMAIL, TELEPHONE)

    for (const cle of cles) {
      const segments = cle.split(':')
      expect(segments).toContain('message-contact')
      expect(segments).toContain('v1')
      expect(segments.at(-1)).toMatch(/^[a-f0-9]{64}$/)
      expect(cle).not.toContain('cabinet-confidentiel')
      expect(cle.toLowerCase()).not.toContain(EMAIL.toLowerCase())
      expect(cle).not.toContain(TELEPHONE)
    }
  })

  it('exige une empreinte unique pour téléphone null : un seul compteur (email), jamais partagé entre visiteurs distincts', async () => {
    const clesA = await clesDe(NAMESPACE, USERNAME, 'visiteur-a@example.com', null)
    const clesB = await clesDe(NAMESPACE, USERNAME, 'visiteur-b@example.com', null)

    expect(hitLimit.mock.calls.filter((appel) => appel[0] === clesA[0])).toHaveLength(1)
    expect(clesA).toHaveLength(1)
    expect(clesB).toHaveLength(1)
    expect(clesA).not.toEqual(clesB)
  })

  it('lève une TooManyRequestsError générique (429) avec le plus grand retryAfter des compteurs bloqués', async () => {
    hitLimit
      .mockResolvedValueOnce({ count: 4, limit: MESSAGE_CONTACT_LIMIT.limit, allowed: false, retryAfter: 19 })
      .mockResolvedValueOnce({ count: 5, limit: MESSAGE_CONTACT_LIMIT.limit, allowed: false, retryAfter: 47 })
    const { enforceContactLimit } = await CONTACT_LIMITEUR()

    const erreur = await captureEchec(enforceContactLimit(NAMESPACE, USERNAME, EMAIL, TELEPHONE))

    expect(erreur).toBeInstanceOf(TooManyRequestsError)
    if (!(erreur instanceof TooManyRequestsError)) throw new TypeError('TooManyRequestsError attendue.')
    expect(erreur.code).toBe('TROP_DE_REQUETES')
    expect(erreur.status).toBe(429)
    expect(erreur.message).toBe(ERROR_MESSAGES.TROP_DE_REQUETES)
    expect(erreur.retryAfter).toBe(47)
    expect(erreur.data).toEqual({ retryAfter: 47 })
    expect(erreur.message).not.toContain(EMAIL)
    expect(erreur.message).not.toContain(TELEPHONE)
    expect(erreur.message).not.toContain(USERNAME)
  })

  it('ignore le retryAfter d’un compteur autorisé quand seul l’autre bloque', async () => {
    hitLimit
      .mockResolvedValueOnce({ count: 4, limit: MESSAGE_CONTACT_LIMIT.limit, allowed: false, retryAfter: 23 })
      .mockResolvedValueOnce({ count: 1, limit: MESSAGE_CONTACT_LIMIT.limit, allowed: true, retryAfter: 999 })
    const { enforceContactLimit } = await CONTACT_LIMITEUR()

    const erreur = await captureEchec(enforceContactLimit(NAMESPACE, USERNAME, EMAIL, TELEPHONE))

    expect(erreur).toBeInstanceOf(TooManyRequestsError)
    if (!(erreur instanceof TooManyRequestsError)) throw new TypeError('TooManyRequestsError attendue.')
    expect(erreur.retryAfter).toBe(23)
  })
})
