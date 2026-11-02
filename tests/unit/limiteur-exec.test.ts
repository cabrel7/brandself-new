import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceUnavailableError, TooManyRequestsError } from '../../server/exceptions/http'

// S8 CHALLENGE (angle mort n°3) / CA30 : `hitLimit` ignorait les erreurs renvoyées par `multi().exec()`
// (ioredis ne rejette PAS quand une commande échoue dans un MULTI : il renvoie [[erreur, null], ...]).
// Pour un poste de coût, « fail-closed » doit couvrir ce cas. Redis n'est simulé ici que pour produire
// une erreur de COMMANDE dans exec (hors du périmètre prouvé : la preuve avec un vrai Redis est dans
// tests/integration/ia-limiteur.test.ts).

const { multi, expire } = vi.hoisted(() => ({ multi: vi.fn(), expire: vi.fn() }))

vi.mock('../../server/utils/redis', () => ({ redis: { multi, expire } }))

const limiteur = () => import('../../server/services/limiteur')

type ResultatCommande = [Error | null, unknown]

function pipeline(resultat: ResultatCommande[] | null | Error) {
  const exec = resultat instanceof Error ? vi.fn().mockRejectedValue(resultat) : vi.fn().mockResolvedValue(resultat)
  const chaine = { incr: vi.fn(), ttl: vi.fn(), exec }
  chaine.incr.mockReturnValue(chaine)
  chaine.ttl.mockReturnValue(chaine)
  multi.mockReturnValue(chaine)
  return chaine
}

const ERREUR_INCR = new Error('ERR value is not an integer or out of range')
const ERREUR_TYPE = new Error('WRONGTYPE Operation against a key holding the wrong kind of value')

beforeEach(() => {
  multi.mockReset()
  expire.mockReset()
  expire.mockResolvedValue(1)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('hitLimit : erreur de commande dans exec (CA30)', () => {
  it('should refuse (LIMITEUR_INDISPONIBLE, 503) when INCR fails inside exec and the limiter is fail-closed', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[ERREUR_INCR, null], [null, -1]])

    const erreur = await hitLimit('ia:u-1', 10, 3600, { failClosed: true }).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(ServiceUnavailableError)
    expect(erreur).toMatchObject({ code: 'LIMITEUR_INDISPONIBLE', status: 503 })
  })

  it('should refuse when the key holds the wrong type (WRONGTYPE) and the limiter is fail-closed', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[ERREUR_TYPE, null], [ERREUR_TYPE, null]])

    await expect(hitLimit('ia:u-1', 10, 3600, { failClosed: true })).rejects.toMatchObject({ code: 'LIMITEUR_INDISPONIBLE' })
  })

  it('should refuse when only the TTL command fails', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[null, 1], [ERREUR_TYPE, null]])

    await expect(hitLimit('ia:u-1', 10, 3600, { failClosed: true })).rejects.toMatchObject({ code: 'LIMITEUR_INDISPONIBLE' })
  })

  it('should refuse when exec answers null (transaction discarded) and the limiter is fail-closed', async () => {
    const { hitLimit } = await limiteur()
    pipeline(null)

    await expect(hitLimit('ia:u-1', 10, 3600, { failClosed: true })).rejects.toMatchObject({ code: 'LIMITEUR_INDISPONIBLE' })
  })

  it('should refuse when exec itself rejects (connection lost) and the limiter is fail-closed', async () => {
    const { hitLimit } = await limiteur()
    pipeline(new Error('Connection is closed.'))

    await expect(hitLimit('ia:u-1', 10, 3600, { failClosed: true })).rejects.toMatchObject({ code: 'LIMITEUR_INDISPONIBLE' })
  })

  it('should not touch the TTL of a key whose counter could not be read', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[ERREUR_INCR, null], [null, -1]])

    await hitLimit('ia:u-1', 10, 3600, { failClosed: true }).catch(() => undefined)

    expect(expire).not.toHaveBeenCalled()
  })

  it('should stay fail-open (allowed, not counted) for a fail-open limiter and log the incident', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[ERREUR_INCR, null], [null, -1]])

    const statut = await hitLimit('lien:clic', 60, 60)

    expect(statut.allowed).toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it('should never log the Redis key or the error text (they can carry a user identifier)', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[ERREUR_INCR, null], [null, -1]])

    await hitLimit('ia:utilisateur-secret-42', 10, 3600, { failClosed: true }).catch(() => undefined)

    const journal = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(journal).not.toContain('utilisateur-secret-42')
    expect(journal).not.toContain('not an integer')
  })
})

describe('hitLimit et enforceLimit : comportement nominal conservé', () => {
  it('should allow a call under the limit and report the remaining window', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[null, 3], [null, 120]])

    const statut = await hitLimit('ia:u-1', 10, 3600, { failClosed: true })

    expect(statut).toEqual({ count: 3, limit: 10, allowed: true, retryAfter: 120 })
    expect(expire).not.toHaveBeenCalled()
  })

  it('should set the window on the first call', async () => {
    const { hitLimit } = await limiteur()
    pipeline([[null, 1], [null, -1]])

    const statut = await hitLimit('ia:u-1', 10, 3600, { failClosed: true })

    expect(statut.retryAfter).toBe(3600)
    expect(expire).toHaveBeenCalledWith('limite:ia:u-1', 3600)
  })

  it('should accept the 10th call and refuse the 11th', async () => {
    const { hitLimit } = await limiteur()

    pipeline([[null, 10], [null, 100]])
    expect((await hitLimit('ia:u-1', 10, 3600, { failClosed: true })).allowed).toBe(true)
    pipeline([[null, 11], [null, 100]])
    expect((await hitLimit('ia:u-1', 10, 3600, { failClosed: true })).allowed).toBe(false)
  })

  it('should throw TooManyRequestsError with the remaining seconds when enforceLimit is over the limit', async () => {
    const { enforceLimit } = await limiteur()
    pipeline([[null, 11], [null, 1800]])

    const erreur = await enforceLimit('ia:u-1', 10, 3600, { failClosed: true }).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(TooManyRequestsError)
    expect(erreur).toMatchObject({ code: 'TROP_DE_REQUETES', status: 429, retryAfter: 1800 })
  })

  it('should throw LIMITEUR_INDISPONIBLE (not a 429) from enforceLimit on a command error', async () => {
    const { enforceLimit } = await limiteur()
    pipeline([[ERREUR_INCR, null], [null, -1]])

    const erreur = await enforceLimit('ia:u-1', 10, 3600, { failClosed: true }).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(ServiceUnavailableError)
    expect(erreur).not.toBeInstanceOf(TooManyRequestsError)
  })
})
