import { describe, expect, it, vi } from 'vitest'
import { PLANS } from '../../server/config/plans'
import { echec, modulePlans } from './support/s10'

// S10 §6 CA90 : `assertQuota` avec `limite: null` ne lève jamais et ne prend AUCUN verrou consultatif (espion sur
// l'exécuteur). Seul ce critère est un test d'espionnage : tout ce qui touche à la base est prouvé en intégration.

type Rangee = Record<string, unknown>

/** Exécuteur factice : chaque `select().from()…` se résout avec la réponse suivante ; `execute` est espionné. */
function executeur(reponses: Rangee[][]) {
  const execute = vi.fn(async () => ({ rows: [] }))
  const select = vi.fn(() => {
    const rangees = reponses.shift() ?? []
    const chaine: Record<string, unknown> = {}
    for (const methode of ['from', 'leftJoin', 'innerJoin', 'where', 'limit', 'orderBy']) chaine[methode] = () => chaine
    chaine.then = (resolve: (valeur: Rangee[]) => unknown) => resolve(rangees)
    return chaine
  })
  return { execute, select }
}

const FUTUR = new Date('2036-01-01T23:00:00.000Z')
const NOW = new Date('2026-11-03T13:00:00.000Z')
// A5 (D-A5-04) : sous verrou, la limite est relue SANS cache dans la transaction (1 lecture des versions actives) ; aucune ligne = repli sur le code.
const VERSIONS_ACTIVES: Rangee[] = []

describe('assertQuota : plan sans limite (CA90)', () => {
  it.each(['services', 'realisations', 'temoignages', 'reservations_mois', 'generations_ia_mois'] as const)('should not throw nor lock anything for %s on the paid plan', async (ressource) => {
    const { assertQuota } = await modulePlans()
    const tx = executeur([[{ fuseau: 'Africa/Douala', plan: 'payant', expireLe: FUTUR }], VERSIONS_ACTIVES])

    const mesure = await assertQuota(tx as never, { userId: 'u', vitrineId: 'v' }, ressource, NOW)

    expect(mesure).toMatchObject({ plan: 'payant', limite: null, atteinte: false })
    expect(tx.execute).not.toHaveBeenCalled()
    // Deux lectures (le plan, puis les versions actives) : rien n'est compté quand la ressource est illimitée.
    expect(tx.select).toHaveBeenCalledTimes(2)
  })
})

describe('assertQuota : plan gratuit', () => {
  it('should refuse with 403 LIMITE_PLAN_ATTEINTE carrying the usage when the limit is reached', async () => {
    const { assertQuota } = await modulePlans()
    const tx = executeur([[{ fuseau: 'Africa/Douala', plan: null, expireLe: null }], VERSIONS_ACTIVES, [{ total: PLANS.gratuit.services }]])

    const erreur = await echec(() => assertQuota(tx as never, { userId: 'u', vitrineId: 'v' }, 'services', NOW))

    expect(erreur).toMatchObject({ code: 'LIMITE_PLAN_ATTEINTE', status: 403 })
  })

  it('should accept when usage is one below the limit', async () => {
    const { assertQuota } = await modulePlans()
    const limite = PLANS.gratuit.services as number
    const tx = executeur([[{ fuseau: 'Africa/Douala', plan: null, expireLe: null }], VERSIONS_ACTIVES, [{ total: limite - 1 }]])

    const mesure = await assertQuota(tx as never, { userId: 'u', vitrineId: 'v' }, 'services', NOW)

    expect(mesure).toMatchObject({ plan: 'gratuit', limite, utilise: limite - 1, atteinte: false })
  })

  it.each(['reservations_mois', 'generations_ia_mois'] as const)('should take exactly one advisory lock for the limited resource %s', async (ressource) => {
    const { assertQuota } = await modulePlans()
    const tx = executeur([[{ fuseau: 'Africa/Douala', plan: null, expireLe: null }], VERSIONS_ACTIVES, [{ total: 0 }]])

    await assertQuota(tx as never, { userId: 'u', vitrineId: 'v' }, ressource, NOW)

    expect(tx.execute).toHaveBeenCalledTimes(1)
  })

  it('should demand a vitrine for a per-vitrine resource instead of counting everything', async () => {
    const { assertQuota } = await modulePlans()
    const tx = executeur([[{ fuseau: 'Africa/Douala', plan: null, expireLe: null }]])

    await expect(assertQuota(tx as never, { userId: 'u' }, 'services', NOW)).rejects.toThrow()
  })
})
