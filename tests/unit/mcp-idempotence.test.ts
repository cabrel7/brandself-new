import { beforeEach, describe, expect, it, vi } from 'vitest'

// Le critère prouvé ici est la COMPARAISON des arguments (empreinte), pas la persistance Redis : on ne remplace
// que le client Redis par une table en mémoire qui respecte SET NX / GET / DEL.
const magasin = new Map<string, string>()
vi.mock('../../server/utils/redis', () => ({
  redis: {
    set: async (cle: string, valeur: string, ...options: unknown[]) => {
      if (options.includes('NX') && magasin.has(cle)) return null
      magasin.set(cle, valeur)
      return 'OK'
    },
    get: async (cle: string) => magasin.get(cle) ?? null,
    del: async (cle: string) => magasin.delete(cle),
  },
}))

const { empreinteArguments, liberer, memoriserResultat, reserverIdempotence } = await import('../../server/mcp/idempotence')

const ARGS = { titre: 'Consultation', dureeMin: 30, inclus: ['a', 'b'], cle_idempotence: 'k1' }

async function jouer(args: unknown, cle = 'k1') {
  return reserverIdempotence('u1', 'a1', 'creer_service', cle, args)
}

beforeEach(() => magasin.clear())

describe('empreinteArguments', () => {
  it('should ignore key order and the idempotency key itself', () => {
    const a = empreinteArguments({ titre: 'x', dureeMin: 30, cle_idempotence: 'k1' })
    const b = empreinteArguments({ cle_idempotence: 'autre', dureeMin: 30, titre: 'x' })
    expect(a).toBe(b)
  })

  it('should differ as soon as one argument differs', () => {
    expect(empreinteArguments({ titre: 'x' })).not.toBe(empreinteArguments({ titre: 'y' }))
    expect(empreinteArguments({ inclus: ['a', 'b'] })).not.toBe(empreinteArguments({ inclus: ['b', 'a'] }))
  })
})

describe('reserverIdempotence (arguments liés à la clé)', () => {
  it('should replay the stored result when the same key comes back with the same arguments', async () => {
    const premiere = await jouer(ARGS)
    if (premiere.etat !== 'nouvelle') throw new Error('première réservation attendue')
    await memoriserResultat(premiere.cle, premiere.empreinte, '{"id":"s1"}')

    expect(await jouer({ ...ARGS })).toEqual({ etat: 'rejouee', resultat: '{"id":"s1"}' })
  })

  it('should report a conflict (never the old result) when the same key comes back with other arguments', async () => {
    const premiere = await jouer(ARGS)
    if (premiere.etat !== 'nouvelle') throw new Error('première réservation attendue')
    await memoriserResultat(premiere.cle, premiere.empreinte, '{"id":"s1"}')

    expect(await jouer({ ...ARGS, titre: 'Autre titre' })).toEqual({ etat: 'conflit' })
  })

  it('should report a conflict while the first call is still running with other arguments', async () => {
    await jouer(ARGS)

    expect(await jouer(ARGS)).toEqual({ etat: 'en_cours' })
    expect(await jouer({ ...ARGS, dureeMin: 45 })).toEqual({ etat: 'conflit' })
  })

  it('should free the key after a failure so the client can retry with other arguments', async () => {
    const premiere = await jouer(ARGS)
    if (premiere.etat !== 'nouvelle') throw new Error('première réservation attendue')
    await liberer(premiere.cle)

    expect((await jouer({ ...ARGS, titre: 'Corrigé' })).etat).toBe('nouvelle')
  })

  it('should scope the key by tool, so another tool never conflicts', async () => {
    await jouer(ARGS)

    const autre = await reserverIdempotence('u1', 'a1', 'creer_realisation', 'k1', { titre: 'z' })
    expect(autre.etat).toBe('nouvelle')
  })
})
