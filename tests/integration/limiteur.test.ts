import { describe, expect, it } from 'vitest'
import { redis } from '../../server/utils/redis'
import { limiteurService } from './support/modules'
import { exigerModulesPresents, rejet } from './support/erreurs'

// Vrai Redis (base /15). Contrat : server/services/limiteur.ts, préfixe de clés `limite:`.
// Le contrat exact de hitLimit (valeur de retour) n'est pas fixé par la spec : on prouve donc
// son effet sur Redis, et le comportement observable d'enforceLimit (qui lève TooManyRequestsError).

const FENETRE_S = 60
const LIMITE_CONTACT_ATTENDUE = 3
const USERNAME_CONTACT = 'dr-cabrel'
const EMAIL_CONTACT = 'patient@example.com'
const TELEPHONE_CONTACT = '+237699000001'

const reservationLimiteurService = () => import('../../server/services/reservation-limiteur')

describe('limiteur (hitLimit / enforceLimit)', () => {
  describe('hitLimit', () => {
    it('should create the counter under the "limite:" prefix with a TTL when first hit', async () => {
      const { hitLimit } = await limiteurService()

      await hitLimit('test:premier', 5, FENETRE_S)

      expect(await redis.get('limite:test:premier')).toBe('1')
      const ttl = await redis.ttl('limite:test:premier')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(FENETRE_S)
    })

    it('should increment the counter on each hit', async () => {
      const { hitLimit } = await limiteurService()

      await hitLimit('test:compteur', 10, FENETRE_S)
      await hitLimit('test:compteur', 10, FENETRE_S)
      await hitLimit('test:compteur', 10, FENETRE_S)

      expect(await redis.get('limite:test:compteur')).toBe('3')
    })

    it('should keep the window fixed (TTL not extended by later hits)', async () => {
      const { hitLimit } = await limiteurService()
      await hitLimit('test:fenetre', 10, FENETRE_S)
      await redis.expire('limite:test:fenetre', 5) // 55 s « écoulées »

      await hitLimit('test:fenetre', 10, FENETRE_S)

      expect(await redis.ttl('limite:test:fenetre')).toBeLessThanOrEqual(5)
    })

    it('should set a TTL when the counter already exists without expiry (no permanent lock-out)', async () => {
      const { hitLimit } = await limiteurService()
      // État laissé par un crash entre INCR et EXPIRE.
      await redis.set('limite:test:sans-ttl', '7')
      expect(await redis.ttl('limite:test:sans-ttl')).toBe(-1)

      await hitLimit('test:sans-ttl', 5, FENETRE_S)

      expect(await redis.ttl('limite:test:sans-ttl')).toBeGreaterThan(0)
    })
  })

  describe('enforceLimit', () => {
    it('should let calls through up to the limit', async () => {
      const { enforceLimit } = await limiteurService()

      for (let i = 0; i < 3; i += 1) {
        await expect(enforceLimit('test:sous-limite', 3, FENETRE_S)).resolves.not.toThrow()
      }
    })

    it('should throw TooManyRequestsError with a positive retryAfter when the limit is exceeded', async () => {
      const { enforceLimit } = await limiteurService()
      for (let i = 0; i < 3; i += 1) {
        await enforceLimit('test:depasse', 3, FENETRE_S)
      }

      const erreur = await rejet(enforceLimit('test:depasse', 3, FENETRE_S))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('TROP_DE_REQUETES')
      expect(erreur.status).toBe(429)
      expect(erreur.retryAfter).toBeGreaterThan(0)
      expect(erreur.retryAfter).toBeLessThanOrEqual(FENETRE_S)
    })

    it('should report the remaining window as retryAfter', async () => {
      const { enforceLimit } = await limiteurService()
      await enforceLimit('test:reste', 1, FENETRE_S)
      await redis.expire('limite:test:reste', 7)

      const erreur = await rejet(enforceLimit('test:reste', 1, FENETRE_S))

      expect(erreur.retryAfter).toBeGreaterThan(0)
      expect(erreur.retryAfter).toBeLessThanOrEqual(7)
    })

    it('should not limit a different key', async () => {
      const { enforceLimit } = await limiteurService()
      await enforceLimit('test:a', 1, FENETRE_S)
      await rejet(enforceLimit('test:a', 1, FENETRE_S))

      await expect(enforceLimit('test:b', 1, FENETRE_S)).resolves.not.toThrow()
    })

    it('should allow calls again once the window has elapsed', async () => {
      const { enforceLimit } = await limiteurService()
      await enforceLimit('test:expire', 1, FENETRE_S)
      await rejet(enforceLimit('test:expire', 1, FENETRE_S))

      await redis.del('limite:test:expire') // expiration du TTL

      await expect(enforceLimit('test:expire', 1, FENETRE_S)).resolves.not.toThrow()
    })

    it('should let exactly `limit` concurrent calls through', async () => {
      const { enforceLimit } = await limiteurService()
      const LIMITE = 30
      const APPELS = 50

      const resultats = await Promise.allSettled(
        Array.from({ length: APPELS }, () => enforceLimit('test:concurrent', LIMITE, FENETRE_S)),
      )

      const acceptes = resultats.filter((r) => r.status === 'fulfilled')
      const refuses = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(acceptes).toHaveLength(LIMITE)
      expect(refuses).toHaveLength(APPELS - LIMITE)
      for (const refus of refuses) {
        expect((refus.reason as { code?: string }).code).toBe('TROP_DE_REQUETES')
      }
    })
  })
})

describe('reservation contact limiter (real Redis)', () => {
  it('should allow exactly three attempts and reject the fourth with 429', async () => {
    const { enforceReservationContactLimit } = await reservationLimiteurService()

    for (let attempt = 0; attempt < LIMITE_CONTACT_ATTENDUE; attempt += 1) {
      await expect(
        enforceReservationContactLimit(USERNAME_CONTACT, EMAIL_CONTACT, TELEPHONE_CONTACT),
      ).resolves.not.toThrow()
    }

    const error = await rejet(
      enforceReservationContactLimit(USERNAME_CONTACT, EMAIL_CONTACT, TELEPHONE_CONTACT),
    )

    expect(error.estDomainError).toBe(true)
    expect(error.code).toBe('TROP_DE_REQUETES')
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBeGreaterThan(0)
    expect(error.retryAfter).toBeLessThanOrEqual(86_400)

    const keys = await redis.keys('limite:*')
    expect(keys).toHaveLength(2)
    await expect(Promise.all(keys.map(key => redis.get(key)))).resolves.toEqual(['4', '4'])
  })

  it('should let exactly three of four concurrent attempts through', async () => {
    const { enforceReservationContactLimit } = await reservationLimiteurService()

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => (
        enforceReservationContactLimit(USERNAME_CONTACT, EMAIL_CONTACT, TELEPHONE_CONTACT)
      )),
    )
    exigerModulesPresents(results)

    const accepted = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(accepted).toHaveLength(LIMITE_CONTACT_ATTENDUE)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({
      code: 'TROP_DE_REQUETES',
      status: 429,
    })

    const keys = await redis.keys('limite:*')
    expect(keys).toHaveLength(2)
    await expect(Promise.all(keys.map(key => redis.get(key)))).resolves.toEqual(['4', '4'])
  })
})
