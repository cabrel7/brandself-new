import { createHmac, hkdfSync, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESABONNEMENT_HKDF_INFO,
  DESABONNEMENT_JETON_LONGUEUR_MAX,
  DESABONNEMENT_JETON_VALIDITE_JOURS,
  DESABONNEMENT_JETON_VERSION,
  PREFERENCES_EMAIL,
} from '../../shared/notifications'
import type { PreferenceEmail } from '../../shared/notifications'
import { schemaJetonDesabonnement } from '../../shared/schemas/notifications'

// S9 §1 #89, §6, CA41, CA42 : jeton de désabonnement HMAC sans état `v1.<payload>.<signature>`.
// Service `server/services/desabonnement.ts` (inexistant : phase RED). Hypothèses de signature, au-delà de la
// spec, à confirmer par le backend :
//   - signUnsubscribeToken(userId, preference, now: Date) -> string (sync ou async, les tests font `await`) ;
//   - verifyUnsubscribeToken(jeton, now: Date) -> { userId, preference } ou lève NotFoundError('JETON_INVALIDE')
//     (404) / GoneError('JETON_EXPIRE') (410), erreurs métier (DomainError) du dépôt ;
//   - clé = HKDF-SHA256(NUXT_BETTER_AUTH_SECRET, sel vide, info = DESABONNEMENT_HKDF_INFO), 32 octets.

const desabonnement = () => import('../../server/services/desabonnement')

const MAINTENANT = new Date('2026-11-02T08:00:00.000Z')
const JOUR_MS = 86_400_000
const UTILISATEUR = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const SECRET = process.env.NUXT_BETTER_AUTH_SECRET ?? ''

interface Echec {
  code: string | undefined
  status: number | undefined
  nom: string
}

async function echec(operation: () => unknown): Promise<Echec> {
  try {
    await operation()
  } catch (erreur) {
    const e = erreur as { code?: string, status?: number, name?: string }
    return { code: e.code, status: e.status, nom: e.name ?? typeof erreur }
  }
  throw new Error("L'opération devait échouer, elle a abouti.")
}

function segments(jeton: string): [string, string, string] {
  const parties = jeton.split('.')
  if (parties.length !== 3) throw new Error(`Jeton à ${parties.length} segments : ${jeton}`)
  return parties as [string, string, string]
}

function charge(jeton: string): { u: string, p: string, e: number } {
  return JSON.parse(Buffer.from(segments(jeton)[1], 'base64url').toString('utf8')) as { u: string, p: string, e: number }
}

function encoder(valeur: unknown): string {
  return Buffer.from(JSON.stringify(valeur), 'utf8').toString('base64url')
}

function autreCaractere(c: string): string {
  return c === 'A' ? 'B' : 'A'
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('signUnsubscribeToken : forme du jeton', () => {
  it('should produce v1.<payload>.<signature> in base64url that the shared Zod schema accepts', async () => {
    const { signUnsubscribeToken } = await desabonnement()

    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)

    expect(jeton.startsWith(`${DESABONNEMENT_JETON_VERSION}.`)).toBe(true)
    expect(segments(jeton)).toHaveLength(3)
    expect(jeton).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(jeton.length).toBeLessThanOrEqual(DESABONNEMENT_JETON_LONGUEUR_MAX)
    expect(schemaJetonDesabonnement.safeParse(jeton).success).toBe(true)
  })

  it.each(PREFERENCES_EMAIL)('should carry only the user id, the preference %s and the expiry in the payload (nothing personal)', async (preference) => {
    const { signUnsubscribeToken } = await desabonnement()

    const jeton = await signUnsubscribeToken(UTILISATEUR, preference, MAINTENANT)

    expect(charge(jeton)).toEqual({
      u: UTILISATEUR,
      p: preference,
      e: Math.floor(MAINTENANT.getTime() / 1000) + DESABONNEMENT_JETON_VALIDITE_JOURS * 86_400,
    })
  })

  it('should be deterministic for the same inputs and different per user, per preference and per instant', async () => {
    const { signUnsubscribeToken } = await desabonnement()

    const reference = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)

    expect(await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)).toBe(reference)
    expect(await signUnsubscribeToken(randomUUID(), 'email_hebdo', MAINTENANT)).not.toBe(reference)
    expect(await signUnsubscribeToken(UTILISATEUR, 'email_rappel_jour', MAINTENANT)).not.toBe(reference)
    expect(await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', new Date(MAINTENANT.getTime() + 2000))).not.toBe(reference)
  })

  it('should sign with a key derived by HKDF-SHA256 (info brandself-desabonnement-v1), never with the raw secret', async () => {
    const { signUnsubscribeToken } = await desabonnement()
    expect(SECRET.length).toBeGreaterThan(31)
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, payload, signature] = segments(jeton)
    const cle = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), DESABONNEMENT_HKDF_INFO, 32))
    const candidats = [payload, `${version}.${payload}`]

    const attendues = candidats.map((entree) => createHmac('sha256', cle).update(entree).digest('base64url'))
    const brutes = candidats.map((entree) => createHmac('sha256', SECRET).update(entree).digest('base64url'))

    expect(attendues).toContain(signature)
    expect(brutes).not.toContain(signature)
  })
})

describe('verifyUnsubscribeToken : jeton valide', () => {
  it.each(PREFERENCES_EMAIL)('should return the user and the preference %s of a freshly signed token', async (preference) => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, preference, MAINTENANT)

    const verifie = await verifyUnsubscribeToken(jeton, MAINTENANT)

    expect(verifie).toEqual({ userId: UTILISATEUR, preference })
  })

  it('should stay valid up to the last day of the 90-day validity (89 days later)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)

    const verifie = await verifyUnsubscribeToken(jeton, new Date(MAINTENANT.getTime() + (DESABONNEMENT_JETON_VALIDITE_JOURS - 1) * JOUR_MS))

    expect(verifie).toMatchObject({ userId: UTILISATEUR })
  })

  it('should not depend on a previous call: verification works on a cold module (no in-memory state, no database)', async () => {
    const premier = await desabonnement()
    const jeton = await premier.signUnsubscribeToken(UTILISATEUR, 'email_rappel_jour', MAINTENANT)
    vi.resetModules()

    const second = await desabonnement()

    expect(await second.verifyUnsubscribeToken(jeton, MAINTENANT)).toEqual({ userId: UTILISATEUR, preference: 'email_rappel_jour' })
  })
})

describe('verifyUnsubscribeToken : expiration (CA42)', () => {
  it('should refuse a token issued 91 days ago with JETON_EXPIRE (410)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)

    const erreur = await echec(() => verifyUnsubscribeToken(jeton, new Date(MAINTENANT.getTime() + 91 * JOUR_MS)))

    expect(erreur).toMatchObject({ code: 'JETON_EXPIRE', status: 410 })
  })

  it('should refuse a token expired by one second', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const expiration = (charge(jeton).e + 1) * 1000

    const erreur = await echec(() => verifyUnsubscribeToken(jeton, new Date(expiration)))

    expect(erreur.code).toBe('JETON_EXPIRE')
  })

  it('should answer INVALIDE, never EXPIRE, for a forged token whose expiry was moved to the past (no information to forgers)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, , signature] = segments(jeton)
    const forge = `${version}.${encoder({ ...charge(jeton), e: 1 })}.${signature}`

    const erreur = await echec(() => verifyUnsubscribeToken(forge, MAINTENANT))

    expect(erreur).toMatchObject({ code: 'JETON_INVALIDE', status: 404 })
  })

  it('should not extend the validity by moving the expiry to the future (signature no longer matches)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, , signature] = segments(jeton)
    const forge = `${version}.${encoder({ ...charge(jeton), e: charge(jeton).e + 10 * 365 * 86_400 })}.${signature}`

    const erreur = await echec(() => verifyUnsubscribeToken(forge, new Date(MAINTENANT.getTime() + 91 * JOUR_MS)))

    expect(erreur.code).toBe('JETON_INVALIDE')
  })
})

describe('verifyUnsubscribeToken : falsification (CA41)', () => {
  it('should refuse a token whose signature has one modified character (404 JETON_INVALIDE)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, payload, signature] = segments(jeton)
    const forge = `${version}.${payload}.${signature.slice(0, -1)}${autreCaractere(signature.at(-1) ?? 'A')}`

    const erreur = await echec(() => verifyUnsubscribeToken(forge, MAINTENANT))

    expect(erreur).toMatchObject({ code: 'JETON_INVALIDE', status: 404 })
  })

  it('should refuse a token whose payload names another preference, keeping the original signature', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, , signature] = segments(jeton)
    const forge = `${version}.${encoder({ ...charge(jeton), p: 'email_rappel_jour' })}.${signature}`

    const erreur = await echec(() => verifyUnsubscribeToken(forge, MAINTENANT))

    expect(erreur.code).toBe('JETON_INVALIDE')
  })

  it('should refuse a token whose payload names another user (cannot unsubscribe someone else)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, , signature] = segments(jeton)
    const forge = `${version}.${encoder({ ...charge(jeton), u: randomUUID() })}.${signature}`

    const erreur = await echec(() => verifyUnsubscribeToken(forge, MAINTENANT))

    expect(erreur.code).toBe('JETON_INVALIDE')
  })

  it('should refuse the signature of a token of another user or another preference spliced onto this payload', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const autre = await signUnsubscribeToken(randomUUID(), 'email_hebdo', MAINTENANT)
    const [version, payload] = segments(jeton)

    const erreur = await echec(() => verifyUnsubscribeToken(`${version}.${payload}.${segments(autre)[2]}`, MAINTENANT))

    expect(erreur.code).toBe('JETON_INVALIDE')
  })

  it('should refuse an unknown version even if the rest is intact', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [, payload, signature] = segments(jeton)

    const erreur = await echec(() => verifyUnsubscribeToken(`v2.${payload}.${signature}`, MAINTENANT))

    expect(erreur.code).toBe('JETON_INVALIDE')
  })

  it('should refuse a token signed under another secret (the key is bound to NUXT_BETTER_AUTH_SECRET)', async () => {
    const { signUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    vi.resetModules()
    vi.stubEnv('NUXT_BETTER_AUTH_SECRET', `${SECRET}-autre-secret-de-rotation`)

    const { verifyUnsubscribeToken } = await desabonnement()
    const erreur = await echec(() => verifyUnsubscribeToken(jeton, MAINTENANT))

    expect(erreur.code).toBe('JETON_INVALIDE')
  })

  it.each([
    ['vide', ''],
    ['sans segments', 'v1'],
    ['deux segments', 'v1.abc'],
    ['signature vide', 'v1.eyJ1IjoiYSJ9.'],
    ['charge vide', 'v1..AAAA'],
    ['quatre segments', 'v1.a.b.c'],
    ['caractères hors base64url', 'v1.!!!!.????'],
    ['espaces', ' v1.abcdefghij.klmnopqrst '],
    ['octets nuls', 'v1.abc\u0000def.ghi'],
    ['sans version', 'eyJ1IjoiYSJ9.AAAAAAAAAAAA'],
    ['très long', `v1.${'a'.repeat(5000)}.${'b'.repeat(5000)}`],
    ['charge JSON valide sans signature réelle', `v1.${encoder({ u: UTILISATEUR, p: 'email_hebdo', e: 4_102_444_800 })}.${'A'.repeat(43)}`],
    ['charge qui n’est pas du JSON', `v1.${Buffer.from('pas du json').toString('base64url')}.${'A'.repeat(43)}`],
  ])('should answer JETON_INVALIDE (404) and never crash for a %s token', async (_libelle, jeton) => {
    const { verifyUnsubscribeToken } = await desabonnement()

    const erreur = await echec(() => verifyUnsubscribeToken(jeton, MAINTENANT))

    expect(erreur).toMatchObject({ code: 'JETON_INVALIDE', status: 404 })
  })

  it('should not throw a RangeError on signatures of unequal length (constant-time compare guards the length first)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, payload, signature] = segments(jeton)

    for (const courte of [signature.slice(0, 5), `${signature}AAAA`, signature.slice(0, -1)]) {
      const erreur = await echec(() => verifyUnsubscribeToken(`${version}.${payload}.${courte}`, MAINTENANT))
      expect(erreur.nom).not.toBe('RangeError')
      expect(erreur.code).toBe('JETON_INVALIDE')
    }
  })

  it('should never echo the token or the user id in the error message', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, payload] = segments(jeton)
    const forge = `${version}.${payload}.${'A'.repeat(43)}`

    try {
      await verifyUnsubscribeToken(forge, MAINTENANT)
    } catch (erreur) {
      const message = (erreur as Error).message
      expect(message).not.toContain(forge)
      expect(message).not.toContain(payload)
      expect(message).not.toContain(UTILISATEUR)
      return
    }
    throw new Error('Le jeton forgé devait être refusé.')
  })
})

describe('preferences et jeton : couverture des deux préférences', () => {
  it('should know exactly two preferences, each signable and verifiable', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const attendues: PreferenceEmail[] = ['email_hebdo', 'email_rappel_jour']

    expect([...PREFERENCES_EMAIL]).toEqual(attendues)
    for (const preference of attendues) {
      const verifie = await verifyUnsubscribeToken(await signUnsubscribeToken(UTILISATEUR, preference, MAINTENANT), MAINTENANT)
      expect(verifie.preference).toBe(preference)
    }
  })
})

describe('pickUnsubscribeToken : le jeton signé est l’autorisation', () => {
  const JETON_CORPS = 'v1.corps.signature'
  const JETON_QUERY = 'v1.query.signature'

  it('should prefer the token of a valid JSON body', async () => {
    const { pickUnsubscribeToken } = await desabonnement()
    expect(pickUnsubscribeToken({ jeton: JETON_CORPS.padEnd(30, 'x') }, JETON_QUERY)).toBe(JETON_CORPS.padEnd(30, 'x'))
  })

  it('should use the query token for the RFC 8058 one-click body', async () => {
    const { pickUnsubscribeToken } = await desabonnement()
    expect(pickUnsubscribeToken({ 'List-Unsubscribe': 'One-Click' }, JETON_QUERY)).toBe(JETON_QUERY)
  })

  it('should fall back on the query token when the body is absent, unreadable or of an unexpected shape', async () => {
    const { pickUnsubscribeToken } = await desabonnement()
    for (const corps of [undefined, null, '', 'texte', 42, [], {}, { autre: 1 }, { jeton: 12 }]) {
      expect(pickUnsubscribeToken(corps, JETON_QUERY), JSON.stringify(corps)).toBe(JETON_QUERY)
    }
  })

  it('should give no token (the service then answers 404 JETON_INVALIDE) when neither body nor query carries one', async () => {
    const { pickUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = pickUnsubscribeToken(undefined, undefined)

    expect(jeton).toBeUndefined()
    expect((await echec(() => verifyUnsubscribeToken(jeton, MAINTENANT))).code).toBe('JETON_INVALIDE')
  })
})

describe('unsubscribeLimitKey : un budget par opération', () => {
  it('should separate the preview and the action counters, and never contain the address in clear', async () => {
    const { unsubscribeLimitKey } = await desabonnement()
    const apercu = unsubscribeLimitKey('203.0.113.7', 'apercu')
    const action = unsubscribeLimitKey('203.0.113.7', 'action')

    expect(apercu).not.toBe(action)
    expect(apercu).toBe(unsubscribeLimitKey('203.0.113.7', 'apercu'))
    expect(`${apercu}${action}`).not.toContain('203.0.113.7')
  })
})
