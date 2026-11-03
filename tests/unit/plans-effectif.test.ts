import { describe, expect, it } from 'vitest'
import { ABONNEMENT_GRACE_JOURS, PLAN_IDS } from '../../shared/plans'
import { iso, JOUR_MS, modulePlans } from './support/s10'

// S10 §1 #119, #121, CA59 : `resoudrePlanEffectif(abonnement | null, now)` est PUR. L'état (actif, grâce, gratuit) est
// calculé depuis `expire_le` (EXCLUSIF) et l'horloge, jamais stocké. Fuseau par défaut Africa/Douala (UTC+1).
// HYPOTHÈSE de signature : (abonnement: { plan, expireLe: Date } | null, now: Date, fuseau?: string).

const EXPIRE = new Date('2026-12-03T23:00:00.000Z') // minuit local du 4 décembre : dernier jour payé = 3 décembre
const GRACE_FIN = new Date('2026-12-10T23:00:00.000Z')
const ABONNEMENT = { plan: 'payant', expireLe: EXPIRE }

async function resoudre(abonnement: { plan: string, expireLe: Date } | null, now: Date) {
  const { resoudrePlanEffectif } = await modulePlans()
  return resoudrePlanEffectif(abonnement as never, now)
}

describe('resoudrePlanEffectif : sans abonnement', () => {
  it('should resolve the free plan with no date when there is no subscription row (CA59)', async () => {
    const r = await resoudre(null, new Date('2026-11-03T13:00:00.000Z'))

    expect(r.plan).toBe('gratuit')
    expect(r.etat).toBe('gratuit')
    expect(r.expireLe ?? null).toBeNull()
    expect(r.graceJusquau ?? null).toBeNull()
    expect(r.joursRestants ?? null).toBeNull()
    expect(r.dernierJourInclus ?? null).toBeNull()
  })
})

describe('resoudrePlanEffectif : actif (expire_le exclusif)', () => {
  it('should be active one second before expiry with one day left and the last included day (CA59)', async () => {
    const r = await resoudre(ABONNEMENT, new Date('2026-12-03T22:59:59.000Z'))

    expect(r).toMatchObject({ plan: 'payant', etat: 'actif', joursRestants: 1, dernierJourInclus: '2026-12-03' })
    expect(iso(r.expireLe)).toBe(EXPIRE.toISOString())
  })

  it('should still be active on the last millisecond before expiry', async () => {
    const r = await resoudre(ABONNEMENT, new Date(EXPIRE.getTime() - 1))

    expect(r.etat).toBe('actif')
    expect(r.plan).toBe('payant')
  })

  it('should count whole remaining days, rounding a started day up (5 days exactly, then 4 days and 1 h)', async () => {
    const cinq = await resoudre(ABONNEMENT, new Date(EXPIRE.getTime() - 5 * JOUR_MS))
    const quatreEtUneHeure = await resoudre(ABONNEMENT, new Date(EXPIRE.getTime() - 4 * JOUR_MS - 3_600_000))

    expect(cinq.joursRestants).toBe(5)
    expect(quatreEtUneHeure.joursRestants).toBe(5)
  })

  it('should be active for a subscription bought long ago and far in the future', async () => {
    const r = await resoudre({ plan: 'payant', expireLe: new Date('2036-01-01T23:00:00.000Z') }, new Date('2026-11-03T13:00:00.000Z'))

    expect(r.etat).toBe('actif')
  })
})

describe('resoudrePlanEffectif : grâce de 7 jours (droits du plan payant conservés)', () => {
  it('should enter the grace period exactly at expiry, with the payer plan still effective (CA59, #121)', async () => {
    const r = await resoudre(ABONNEMENT, EXPIRE)

    expect(r.etat).toBe('grace')
    expect(r.plan).toBe('payant')
    expect(iso(r.graceJusquau)).toBe(GRACE_FIN.toISOString())
  })

  it('should last exactly ABONNEMENT_GRACE_JOURS days', async () => {
    const r = await resoudre(ABONNEMENT, EXPIRE)

    expect(ABONNEMENT_GRACE_JOURS).toBe(7)
    expect(new Date(iso(r.graceJusquau) ?? '').getTime() - EXPIRE.getTime()).toBe(ABONNEMENT_GRACE_JOURS * JOUR_MS)
  })

  it('should still be in grace on the last millisecond of the grace period', async () => {
    const r = await resoudre(ABONNEMENT, new Date(GRACE_FIN.getTime() - 1))

    expect(r.etat).toBe('grace')
    expect(r.plan).toBe('payant')
  })

  it('should come back to the free plan exactly at the end of the grace period (CA59)', async () => {
    const r = await resoudre(ABONNEMENT, GRACE_FIN)

    expect(r.plan).toBe('gratuit')
    expect(r.etat).toBe('gratuit')
  })

  it('should stay on the free plan long after the end of the grace period', async () => {
    const r = await resoudre(ABONNEMENT, new Date('2030-01-01T00:00:00.000Z'))

    expect(r).toMatchObject({ plan: 'gratuit', etat: 'gratuit' })
  })
})

describe('resoudrePlanEffectif : entrées inattendues', () => {
  it('should be pure : the input row is not modified and the same input gives the same result', async () => {
    const ligne = Object.freeze({ plan: 'payant', expireLe: new Date(EXPIRE) })
    const now = new Date('2026-12-05T10:00:00.000Z')

    const premier = await resoudre(ligne, now)
    const second = await resoudre(ligne, now)

    expect(second).toEqual(premier)
    expect(ligne.expireLe.getTime()).toBe(EXPIRE.getTime())
  })

  it('should never return a plan outside the known plans, even for a row with an unknown plan name (a valid CHECK value)', async () => {
    // Le CHECK de la base accepte tout `^[a-z_]{1,30}$` sauf « gratuit » : une ligne « premium » est possible. Un plan
    // inconnu ne doit jamais atteindre `PLANS[plan]` (TypeError sur toutes les pages publiques de la vitrine).
    const r = await resoudre({ plan: 'premium', expireLe: new Date('2036-01-01T23:00:00.000Z') }, new Date('2026-11-03T13:00:00.000Z'))

    expect(PLAN_IDS).toContain(r.plan)
  })

  it('should compute the last included day in the subscription time zone (Douala), not in UTC nor in the machine time zone', async () => {
    const avant = process.env.TZ
    try {
      process.env.TZ = 'Pacific/Pago_Pago'
      const r = await resoudre(ABONNEMENT, new Date('2026-12-03T10:00:00.000Z'))
      expect(r.dernierJourInclus).toBe('2026-12-03')
    } finally {
      if (avant === undefined) delete process.env.TZ
      else process.env.TZ = avant
    }
  })
})
