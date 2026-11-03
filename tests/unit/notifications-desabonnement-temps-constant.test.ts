import { timingSafeEqual } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S9 §1 #89, CA41 : la signature du jeton est comparée à TEMPS CONSTANT (timingSafeEqual), jamais avec `===`.
// `node:crypto` est enveloppé (comportement réel conservé) pour observer l'appel : c'est la seule façon de prouver
// l'exigence sans mesurer des durées (fragile). Service `server/services/desabonnement.ts` : phase RED.

vi.mock('node:crypto', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:crypto')>()
  const enveloppe = vi.fn(reel.timingSafeEqual)
  return { ...reel, timingSafeEqual: enveloppe, default: { ...reel, timingSafeEqual: enveloppe } }
})

const desabonnement = () => import('../../server/services/desabonnement')

const MAINTENANT = new Date('2026-11-02T08:00:00.000Z')
const UTILISATEUR = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

beforeEach(() => {
  vi.mocked(timingSafeEqual).mockClear()
})

describe('verifyUnsubscribeToken : comparaison à temps constant', () => {
  it('should compare the signature with timingSafeEqual on two buffers of equal length for a valid token', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    vi.mocked(timingSafeEqual).mockClear()

    await verifyUnsubscribeToken(jeton, MAINTENANT)

    expect(vi.mocked(timingSafeEqual)).toHaveBeenCalled()
    for (const [a, b] of vi.mocked(timingSafeEqual).mock.calls) {
      expect((a as Uint8Array).byteLength).toBe((b as Uint8Array).byteLength)
    }
  })

  it('should still go through timingSafeEqual for a token whose signature is wrong but well-formed', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, payload, signature] = jeton.split('.') as [string, string, string]
    const faux = `${version}.${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    vi.mocked(timingSafeEqual).mockClear()

    await expect(Promise.resolve().then(() => verifyUnsubscribeToken(faux, MAINTENANT))).rejects.toMatchObject({ code: 'JETON_INVALIDE' })

    expect(vi.mocked(timingSafeEqual)).toHaveBeenCalled()
  })

  it('should never hand timingSafeEqual buffers of different lengths (it would throw RangeError)', async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await desabonnement()
    const jeton = await signUnsubscribeToken(UTILISATEUR, 'email_hebdo', MAINTENANT)
    const [version, payload, signature] = jeton.split('.') as [string, string, string]
    vi.mocked(timingSafeEqual).mockClear()

    await expect(Promise.resolve().then(() => verifyUnsubscribeToken(`${version}.${payload}.${signature.slice(0, 10)}`, MAINTENANT)))
      .rejects.toMatchObject({ code: 'JETON_INVALIDE' })

    for (const [a, b] of vi.mocked(timingSafeEqual).mock.calls) {
      expect((a as Uint8Array).byteLength).toBe((b as Uint8Array).byteLength)
    }
  })
})
