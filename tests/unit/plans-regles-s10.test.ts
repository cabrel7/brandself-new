import { describe, expect, it } from 'vitest'
import { modulePlansRegles } from './support/s10'

// S10 §1 #124 et #127, §5.1 : règles PURES des plans (server/services/plans-regles.ts).
// Masquage : au-delà de la limite, seuls les N plus anciens éléments ACTIFS restent visibles (created_at, id croissants),
// l'ordre d'affichage est inchangé. Mois civil : fuseau de la vitrine.

interface Ligne { id: string, actif: boolean, createdAt: Date }

const jour = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 8))
const ligne = (id: string, n: number, actif = true): Ligne => ({ id, actif, createdAt: jour(n) })

describe('appliquerPlafondPublic (CA65, CA67, CA92)', () => {
  it('should keep the N oldest active items and keep the display order of the input', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()
    // Ordre d'affichage (par « ordre ») différent de l'ancienneté : e (jour 4), c (jour 2), a (jour 0), d (jour 3), b (jour 1).
    const affichage = [ligne('e', 4), ligne('c', 2), ligne('a', 0), ligne('d', 3), ligne('b', 1)]

    expect(appliquerPlafondPublic(affichage, 3).map((l) => l.id)).toEqual(['c', 'a', 'b'])
  })

  it('should keep everything when the limit is null (unlimited plan)', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()
    const items = Array.from({ length: 12 }, (_v, i) => ligne(`i${i}`, i))

    expect(appliquerPlafondPublic(items, null)).toHaveLength(12)
  })

  it('should keep everything when there are fewer items than the limit, and nothing for a limit of 0', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()

    expect(appliquerPlafondPublic([ligne('a', 0), ligne('b', 1)], 3)).toHaveLength(2)
    expect(appliquerPlafondPublic([ligne('a', 0)], 0)).toHaveLength(0)
    expect(appliquerPlafondPublic([], 3)).toEqual([])
  })

  it('should not count inactive items in the limit : hiding an old one frees its place for a newer one (CA67)', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()
    const items = [ligne('s1', 0, false), ligne('s2', 1), ligne('s3', 2), ligne('s4', 3), ligne('s5', 4)]

    expect(appliquerPlafondPublic(items, 3).map((l) => l.id)).toEqual(['s2', 's3', 's4'])
  })

  it('should never show an inactive item, whatever the limit', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()

    expect(appliquerPlafondPublic([ligne('a', 0, false)], null)).toEqual([])
  })

  it('should break creation date ties on the id, deterministically, whatever the input order', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()
    const memeInstant = jour(0)
    const items = ['c', 'a', 'b'].map((id) => ({ id, actif: true, createdAt: memeInstant }))

    expect(appliquerPlafondPublic(items, 2).map((l) => l.id).sort()).toEqual(['a', 'b'])
    expect(appliquerPlafondPublic([...items].reverse(), 2).map((l) => l.id).sort()).toEqual(['a', 'b'])
  })

  it('should not mutate its input and should keep the same object references', async () => {
    const { appliquerPlafondPublic } = await modulePlansRegles()
    const items = Object.freeze([ligne('b', 1), ligne('a', 0)])

    const resultat = appliquerPlafondPublic(items, 1)

    expect(items.map((l) => l.id)).toEqual(['b', 'a'])
    expect(resultat[0]).toBe(items[1])
  })
})

describe('idsMasquesParPlan et construireLimitePlan (CA70)', () => {
  it('should hide the 4th and 5th active items of a free plan limited to 3 and report the limit as reached', async () => {
    const { idsMasquesParPlan, construireLimitePlan } = await modulePlansRegles()
    const items = Array.from({ length: 5 }, (_v, i) => ligne(`s${i + 1}`, i))

    expect([...idsMasquesParPlan(items, 3)].sort()).toEqual(['s4', 's5'])
    expect(construireLimitePlan(5, 3)).toEqual({ limite: 3, utilise: 5, atteinte: true })
    expect(construireLimitePlan(2, 3)).toEqual({ limite: 3, utilise: 2, atteinte: false })
    expect(construireLimitePlan(3, 3).atteinte).toBe(true)
    expect(construireLimitePlan(500, null)).toEqual({ limite: null, utilise: 500, atteinte: false })
  })
})

describe('bornesMoisLocal et debutMoisLocal (CA82)', () => {
  it('should bound November 2026 in Douala (UTC+1) from 31 October 23:00Z (included) to 30 November 23:00Z (excluded)', async () => {
    const { bornesMoisLocal } = await modulePlansRegles()

    const { debut, fin } = bornesMoisLocal(new Date('2026-11-15T12:00:00.000Z'), 'Africa/Douala')

    expect(debut.toISOString()).toBe('2026-10-31T23:00:00.000Z')
    expect(fin.toISOString()).toBe('2026-11-30T23:00:00.000Z')
  })

  it('should still be in November at 2026-11-30T22:59:59.999Z and in December from 23:00:00.000Z (CA82)', async () => {
    const { bornesMoisLocal } = await modulePlansRegles()

    expect(bornesMoisLocal(new Date('2026-11-30T22:59:59.999Z'), 'Africa/Douala').debut.toISOString()).toBe('2026-10-31T23:00:00.000Z')
    expect(bornesMoisLocal(new Date('2026-11-30T23:00:00.000Z'), 'Africa/Douala').debut.toISOString()).toBe('2026-11-30T23:00:00.000Z')
  })

  it('should follow the local month length and the daylight saving time (Paris, March 2027 has a 23 hour day)', async () => {
    const { bornesMoisLocal } = await modulePlansRegles()

    const { debut, fin } = bornesMoisLocal(new Date('2027-03-15T12:00:00.000Z'), 'Europe/Paris')

    expect(debut.toISOString()).toBe('2027-02-28T23:00:00.000Z')
    expect(fin.toISOString()).toBe('2027-03-31T22:00:00.000Z')
  })

  it('should cross the year (December -> January) and handle February of a leap year', async () => {
    const { bornesMoisLocal } = await modulePlansRegles()

    expect(bornesMoisLocal(new Date('2026-12-20T12:00:00.000Z'), 'Africa/Douala').fin.toISOString()).toBe('2026-12-31T23:00:00.000Z')
    const fevrier = bornesMoisLocal(new Date('2028-02-10T12:00:00.000Z'), 'Africa/Douala')
    expect(fevrier.fin.getTime() - fevrier.debut.getTime()).toBe(29 * 86_400_000)
  })

  it('should fall back to Africa/Douala for an invalid time zone instead of failing', async () => {
    const { bornesMoisLocal, debutMoisLocal } = await modulePlansRegles()

    expect(bornesMoisLocal(new Date('2026-11-15T12:00:00.000Z'), 'Mars/Olympus').debut.toISOString()).toBe('2026-10-31T23:00:00.000Z')
    expect(debutMoisLocal(new Date('2026-11-15T12:00:00.000Z'), 'Africa/Douala').toISOString()).toBe('2026-10-31T23:00:00.000Z')
  })
})

describe('construireErreurLimite (CA78)', () => {
  it('should build a 403 LIMITE_PLAN_ATTEINTE carrying only resource, limit, usage and plan', async () => {
    const { construireErreurLimite } = await modulePlansRegles()

    const erreur = construireErreurLimite('services', { limite: 3, utilise: 3, plan: 'gratuit' })

    expect(erreur).toMatchObject({ status: 403, code: 'LIMITE_PLAN_ATTEINTE', data: { ressource: 'services', limite: 3, utilise: 3, plan: 'gratuit' } })
    expect(Object.keys(erreur.data ?? {}).sort()).toEqual(['limite', 'plan', 'ressource', 'utilise'])
  })
})
