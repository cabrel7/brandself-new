import { describe, expect, it } from 'vitest'
import { NEXT_STEPS } from '../../shared/vitrine'

// S8 §0 #78 / CA51 : la prochaine étape suit l'ordre photo → service → disponibilités → réalisation.
// S9 (#93) : NEXT_STEPS gagne `partager` en dernier, et l'entrée de computeNextStep gagne `publiee`, `partagee`
// et `ignorees`. Les cas S8 ci-dessous sont rejoués avec une vitrine NON publiée (jamais « partager ») : leurs
// résultats sont inchangés. Les cas propres à S9 sont dans tests/unit/notifications-prochaine-etape.test.ts.

const regles = () => import('../../server/services/vitrines-regles')

const S9_NEUTRE = { publiee: false, partagee: false, ignorees: [] as never[] }

describe('NEXT_STEPS', () => {
  it('should order photo, service, disponibilites, realisation, partager', () => {
    expect([...NEXT_STEPS]).toEqual(['photo', 'service', 'disponibilites', 'realisation', 'partager'])
  })
})

describe('computeNextStep (CA51)', () => {
  it.each([
    [{ hasPhoto: false, servicesActifs: 0, disponibilites: 0, realisationsActives: 0 }, 'photo'],
    [{ hasPhoto: false, servicesActifs: 3, disponibilites: 5, realisationsActives: 3 }, 'photo'],
    [{ hasPhoto: true, servicesActifs: 0, disponibilites: 0, realisationsActives: 0 }, 'service'],
    [{ hasPhoto: true, servicesActifs: 0, disponibilites: 5, realisationsActives: 4 }, 'service'],
    [{ hasPhoto: true, servicesActifs: 1, disponibilites: 0, realisationsActives: 0 }, 'disponibilites'],
    [{ hasPhoto: true, servicesActifs: 5, disponibilites: 0, realisationsActives: 2 }, 'disponibilites'],
    [{ hasPhoto: true, servicesActifs: 1, disponibilites: 1, realisationsActives: 0 }, 'realisation'],
    [{ hasPhoto: true, servicesActifs: 2, disponibilites: 7, realisationsActives: 0 }, 'realisation'],
    [{ hasPhoto: true, servicesActifs: 1, disponibilites: 1, realisationsActives: 1 }, null],
    [{ hasPhoto: true, servicesActifs: 9, disponibilites: 9, realisationsActives: 9 }, null],
  ])('should answer for %j', async (etat, attendu) => {
    const { computeNextStep } = await regles()

    expect(computeNextStep({ ...etat, ...S9_NEUTRE })).toBe(attendu)
  })

  it('should walk the full ladder as the vitrine fills up (unpublished: it ends at null)', async () => {
    const { computeNextStep } = await regles()
    const etat = { hasPhoto: false, servicesActifs: 0, disponibilites: 0, realisationsActives: 0, ...S9_NEUTRE }

    const parcours = [
      computeNextStep(etat),
      computeNextStep({ ...etat, hasPhoto: true }),
      computeNextStep({ ...etat, hasPhoto: true, servicesActifs: 1 }),
      computeNextStep({ ...etat, hasPhoto: true, servicesActifs: 1, disponibilites: 1 }),
      computeNextStep({ ...etat, hasPhoto: true, servicesActifs: 1, disponibilites: 1, realisationsActives: 1 }),
    ]

    expect(parcours).toEqual(['photo', 'service', 'disponibilites', 'realisation', null])
  })

  it('should answer only values of NEXT_STEPS (or null)', async () => {
    const { computeNextStep } = await regles()

    for (const hasPhoto of [true, false]) {
      for (const servicesActifs of [0, 1]) {
        for (const disponibilites of [0, 1]) {
          for (const realisationsActives of [0, 1]) {
            for (const publiee of [true, false]) {
              const etape = computeNextStep({ hasPhoto, servicesActifs, disponibilites, realisationsActives, publiee, partagee: false, ignorees: [] })
              expect(etape === null || (NEXT_STEPS as readonly string[]).includes(etape)).toBe(true)
            }
          }
        }
      }
    }
  })
})
