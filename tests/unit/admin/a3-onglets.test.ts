import { describe, expect, it } from 'vitest'
import { ABONNEMENT_ONGLETS } from '../../../shared/admin-paiements'
import { ongletAbonnement } from '../../../server/services/admin/abonnements'

// A3 CA06 et D-A3-14 : les trois onglets d'abonnements sont une PARTITION sans recouvrement de ]now - 37 j ; now + 7 j]. Fonction
// pure, `now` passé en argument, bornes prouvées à la milliseconde (la route ne sait pas poser ces bornes exactes : elle lit
// l'horloge système, voir tests/integration/admin/a3-abonnements.test.ts).

const NOW = new Date('2026-11-14T10:00:00.000Z')
const JOUR_MS = 86_400_000
const apres = (ms: number): Date => new Date(NOW.getTime() + ms)

describe('ongletAbonnement : les exemples de la spec (CA06)', () => {
  it.each([
    ['now + 3 jours', 3 * JOUR_MS, 'renouvellement'],
    ['now - 2 jours', -2 * JOUR_MS, 'grace'],
    ['now - 20 jours', -20 * JOUR_MS, 'expires'],
    ['now - 40 jours', -40 * JOUR_MS, null],
    ['now + 30 jours', 30 * JOUR_MS, null],
  ] as const)('should put %s in %s', (_titre, decalage, attendu) => {
    expect(ongletAbonnement(apres(decalage), NOW)).toBe(attendu)
  })
})

describe('ongletAbonnement : bornes exactes (D-A3-14)', () => {
  it.each([
    ['now + 1 ms', 1, 'renouvellement'],
    ['now + 7 jours (inclus)', 7 * JOUR_MS, 'renouvellement'],
    ['now + 7 jours + 1 ms', 7 * JOUR_MS + 1, null],
    ['now (échéance atteinte : en grâce)', 0, 'grace'],
    ['now - 1 ms', -1, 'grace'],
    ['now - 7 jours + 1 ms', -7 * JOUR_MS + 1, 'grace'],
    ['now - 7 jours (exclu de la grâce : expiré)', -7 * JOUR_MS, 'expires'],
    ['now - 37 jours + 1 ms', -37 * JOUR_MS + 1, 'expires'],
    ['now - 37 jours (exclu)', -37 * JOUR_MS, null],
    ['now - 37 jours - 1 ms', -37 * JOUR_MS - 1, null],
  ] as const)('should classify %s as %s', (_titre, decalage, attendu) => {
    expect(ongletAbonnement(apres(decalage), NOW)).toBe(attendu)
  })

  it('should treat the three onglets as a partition: every expiry from -45 to +15 days belongs to AT MOST one tab, and to exactly one inside ]-37 j ; +7 j]', () => {
    for (let decalage = -45 * JOUR_MS; decalage <= 15 * JOUR_MS; decalage += 3_600_000) {
      const onglet = ongletAbonnement(apres(decalage), NOW)
      const dedans = decalage > -37 * JOUR_MS && decalage <= 7 * JOUR_MS
      expect(onglet !== null, `décalage ${decalage / 3_600_000} h`).toBe(dedans)
      if (onglet !== null) expect(ABONNEMENT_ONGLETS).toContain(onglet)
    }
  })

  it('should classify by the injected instant, never by the system clock', () => {
    const lointain = new Date('2031-06-01T00:00:00.000Z')

    expect(ongletAbonnement(new Date(lointain.getTime() + 2 * JOUR_MS), lointain)).toBe('renouvellement')
    expect(ongletAbonnement(new Date(lointain.getTime() + 2 * JOUR_MS), NOW)).toBeNull()
  })
})
