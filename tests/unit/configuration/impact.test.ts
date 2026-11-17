import { beforeEach, describe, expect, it, vi } from 'vitest'
import { schemaImpactPlan } from '../../../shared/schemas/admin-versions'
import { PLANS } from '../../../server/config/plans'

// A5 D-A5-06 et §6 : `apercuImpactPlan(plan, valeursCandidates)`. Le calcul SQL lui-même (grâce, vitrines publiées, comptes
// distincts) est prouvé sur la VRAIE base dans tests/integration/admin/a5-versions-plans.test.ts (CA03, CA04). Ici : la
// règle « un plan payant illimité n'est pas aperçu » et la forme du résultat. La base est une fausse base qui compte ses lectures.

const base = vi.hoisted(() => ({ lectures: 0, ligne: { comptes: '1', elements_masques: '2' } }))

vi.mock('../../../server/utils/db', () => {
  const lire = (): Promise<unknown> => {
    base.lectures += 1
    return Promise.resolve(Object.assign([base.ligne], { rows: [base.ligne] }))
  }
  const chaine: unknown = new Proxy(() => undefined, {
    get: (_cible, propriete) => (propriete === 'then'
      ? (ok: (valeur: unknown) => unknown, ko: (erreur: unknown) => unknown) => lire().then(ok, ko)
      : chaine),
    apply: () => chaine,
  })
  return { db: chaine }
})

const gratuit = (services: number) => ({ ...PLANS.gratuit, services, capacites: { mcp: false } })
const payantIllimite = { ...PLANS.payant, capacites: { mcp: true } }

beforeEach(() => {
  base.lectures = 0
})

describe('apercuImpactPlan', () => {
  it('should answer zero everywhere and read nothing when the paid plan stays unlimited (nothing can be hidden)', async () => {
    const { apercuImpactPlan } = await import('../../../server/services/configuration/impact')

    const impact = await apercuImpactPlan('payant', payantIllimite)

    expect(base.lectures).toBe(0)
    expect(schemaImpactPlan.parse(impact)).toEqual({
      services: { comptes: 0, elementsMasques: 0 },
      realisations: { comptes: 0, elementsMasques: 0 },
      temoignages: { comptes: 0, elementsMasques: 0 },
      reservationsMois: { comptes: 0 },
      generationsIaMois: { comptes: 0 },
    })
  })

  it('should return whole numbers (counts come back as text from PostgreSQL) in the strict shape of the contract', async () => {
    const { apercuImpactPlan } = await import('../../../server/services/configuration/impact')

    const impact = schemaImpactPlan.parse(await apercuImpactPlan('gratuit', gratuit(3)))

    expect(base.lectures).toBeGreaterThan(0)
    expect(impact.services).toEqual({ comptes: 1, elementsMasques: 2 })
    expect(Number.isInteger(impact.reservationsMois.comptes)).toBe(true)
  })
})
