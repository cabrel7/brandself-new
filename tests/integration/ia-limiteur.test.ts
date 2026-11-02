import { afterEach, describe, expect, it, vi } from 'vitest'
import { redis } from '../../server/utils/redis'
import { IA_UTILISATEUR_LIMIT } from '../../shared/limites'
import { limiteurService } from './support/modules'
import { rejet } from './support/erreurs'

// S8 CHALLENGE n°3 / CA30 : le limiteur « fail-closed » doit l'être aussi quand une COMMANDE échoue dans le MULTI
// (ioredis ne rejette pas : il renvoie [[erreur, null], ...]). Vrai Redis /15, aucune simulation : une clé qui
// contient une valeur non entière (ou d'un autre type) fait réellement échouer INCR.

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hitLimit avec une clé corrompue (vrai Redis)', () => {
  it('should refuse with LIMITEUR_INDISPONIBLE (503) when INCR fails on a non-integer value and the limiter is fail-closed', async () => {
    const { hitLimit } = await limiteurService()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await redis.set('limite:ia:corrompu', 'abc')

    const erreur = await rejet(hitLimit('ia:corrompu', IA_UTILISATEUR_LIMIT.limit, IA_UTILISATEUR_LIMIT.windowS, { failClosed: true }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('LIMITEUR_INDISPONIBLE')
    expect(erreur.status).toBe(503)
  })

  it('should refuse when the key holds another Redis type (WRONGTYPE)', async () => {
    const { enforceLimit } = await limiteurService()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await redis.lpush('limite:ia:liste', 'a')

    const erreur = await rejet(enforceLimit('ia:liste', IA_UTILISATEUR_LIMIT.limit, IA_UTILISATEUR_LIMIT.windowS, { failClosed: true }))

    expect(erreur.code).toBe('LIMITEUR_INDISPONIBLE')
  })

  it('should stay fail-open for a limiter that is not fail-closed (the visitor is not blocked by a Redis fault)', async () => {
    const { hitLimit } = await limiteurService()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await redis.set('limite:lien:corrompu', 'abc')

    const statut = await hitLimit('lien:corrompu', 60, 60)

    expect(statut.allowed).toBe(true)
  })

  it('should keep counting normally on a healthy key, accept the 10th call and refuse the 11th', async () => {
    const { hitLimit } = await limiteurService()

    const statuts = []
    for (let i = 0; i < IA_UTILISATEUR_LIMIT.limit + 1; i += 1) {
      statuts.push(await hitLimit('ia:sain', IA_UTILISATEUR_LIMIT.limit, IA_UTILISATEUR_LIMIT.windowS, { failClosed: true }))
    }

    expect(statuts.slice(0, 10).every((s) => s.allowed)).toBe(true)
    expect(statuts[10]!.allowed).toBe(false)
    expect(statuts[10]!.retryAfter).toBeGreaterThan(0)
    expect(statuts[10]!.retryAfter).toBeLessThanOrEqual(IA_UTILISATEUR_LIMIT.windowS)
  })

  it('should isolate users: the counter of A does not affect B', async () => {
    const { hitLimit } = await limiteurService()
    for (let i = 0; i < 11; i += 1) await hitLimit('ia:utilisateur-a', 10, 3600, { failClosed: true })

    const b = await hitLimit('ia:utilisateur-b', 10, 3600, { failClosed: true })

    expect(b).toMatchObject({ count: 1, allowed: true })
  })
})
