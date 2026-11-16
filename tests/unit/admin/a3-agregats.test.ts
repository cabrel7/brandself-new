import { describe, expect, it } from 'vitest'
import { ADMIN_REVENUS_REPARTITION_MOIS } from '../../../shared/limites'
import { bornesMois, versEntierSur } from '../../../server/services/admin/revenus'

// A3 §3 « Les agrégats sum(bigint) arrivent en chaîne : conversion avec Number.isSafeInteger » et §8 « répartition en mois
// locaux ». Montants en entiers, jamais de flottant ni d'arrondi silencieux ; mois civils dans le fuseau de l'administration.

describe('versEntierSur : conversion des agrégats PostgreSQL', () => {
  it.each([
    ['0', 0],
    ['47000', 47_000],
    ['3000000000', 3_000_000_000],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    [12, 12],
    [0, 0],
    [null, 0],
    [undefined, 0],
  ] as const)('should convert %s to %s', (entree, attendu) => {
    expect(versEntierSur(entree)).toBe(attendu)
  })

  it.each([
    ['un montant décimal en chaîne', '12.5'],
    ['un nombre décimal', 12.5],
    ['au-delà du plus grand entier sûr', '9007199254740993'],
    ['un négatif', '-1'],
    ['du texte', 'abc'],
    ['NaN', Number.NaN],
    ['l\'infini', Number.POSITIVE_INFINITY],
  ])('should REFUSE %s instead of rounding it silently', (_titre, entree) => {
    expect(() => versEntierSur(entree as string | number | bigint)).toThrow(RangeError)
  })
})

describe('versEntierSur : bigint trop grand', () => {
  it('should refuse a bigint beyond the safe integers', () => {
    expect(() => versEntierSur(9007199254740993n)).toThrow(RangeError)
  })
})

describe('bornesMois : mois civils locaux, [début, fin[', () => {
  const iso = (d: Date) => d.toISOString()

  it('should cut the months at the local midnight of Africa/Douala (UTC+1)', () => {
    const bornes = bornesMois(new Date('2026-11-15T10:00:00.000Z'), 'Africa/Douala')

    expect(iso(bornes.courant.debut)).toBe('2026-10-31T23:00:00.000Z')
    expect(iso(bornes.courant.fin)).toBe('2026-11-30T23:00:00.000Z')
    expect(iso(bornes.precedent.debut)).toBe('2026-09-30T23:00:00.000Z')
    expect(iso(bornes.precedent.fin)).toBe('2026-10-31T23:00:00.000Z')
  })

  it('should chain: the end of the previous month is the start of the current one', () => {
    const bornes = bornesMois(new Date('2026-03-02T12:00:00.000Z'), 'Africa/Douala')

    expect(iso(bornes.precedent.fin)).toBe(iso(bornes.courant.debut))
  })

  it.each([
    ['one second before local midnight of the 1st (still October)', '2026-10-31T22:59:59.999Z', '2026-09-30T23:00:00.000Z', '2026-10-31T23:00:00.000Z'],
    ['exactly local midnight of the 1st (November starts)', '2026-10-31T23:00:00.000Z', '2026-10-31T23:00:00.000Z', '2026-11-30T23:00:00.000Z'],
    ['00:30 local on the 1st (UTC is still the 31st)', '2026-10-31T23:30:00.000Z', '2026-10-31T23:00:00.000Z', '2026-11-30T23:00:00.000Z'],
    ['the very last millisecond of November (local)', '2026-11-30T22:59:59.999Z', '2026-10-31T23:00:00.000Z', '2026-11-30T23:00:00.000Z'],
    ['the first millisecond of December (local)', '2026-11-30T23:00:00.000Z', '2026-11-30T23:00:00.000Z', '2026-12-31T23:00:00.000Z'],
  ])('should resolve %s', (_titre, maintenant, debut, fin) => {
    const bornes = bornesMois(new Date(maintenant), 'Africa/Douala')

    expect(iso(bornes.courant.debut)).toBe(debut)
    expect(iso(bornes.courant.fin)).toBe(fin)
  })

  it('should cross the year: January gives December as the previous month', () => {
    const bornes = bornesMois(new Date('2027-01-10T08:00:00.000Z'), 'Africa/Douala')

    expect(iso(bornes.courant.debut)).toBe('2026-12-31T23:00:00.000Z')
    expect(iso(bornes.precedent.debut)).toBe('2026-11-30T23:00:00.000Z')
  })

  it('should follow daylight saving time: a month is not always a multiple of 24 hours (Europe/Paris, March 2026)', () => {
    const bornes = bornesMois(new Date('2026-03-29T12:00:00.000Z'), 'Europe/Paris')

    expect(iso(bornes.courant.debut)).toBe('2026-02-28T23:00:00.000Z')
    expect(iso(bornes.courant.fin)).toBe('2026-03-31T22:00:00.000Z')
  })

  it(`should start the breakdown ${ADMIN_REVENUS_REPARTITION_MOIS - 1} months before the current month (the current one included)`, () => {
    const bornes = bornesMois(new Date('2026-11-15T10:00:00.000Z'), 'Africa/Douala')

    expect(iso(bornes.debutRepartition)).toBe('2025-11-30T23:00:00.000Z')
  })

  it('should use the injected instant, never the system clock', () => {
    expect(iso(bornesMois(new Date('2031-06-10T00:00:00.000Z'), 'Africa/Douala').courant.debut)).toBe('2031-05-31T23:00:00.000Z')
  })
})
