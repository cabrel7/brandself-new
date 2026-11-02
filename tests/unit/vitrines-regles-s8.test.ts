import { describe, expect, it } from 'vitest'
import { NEXT_STEPS } from '../../shared/vitrine'

// S8 §0 #78 / CA51 : la prochaine étape suit l'ordre photo → service → disponibilités → réalisation.
// ÉCART À SIGNALER AU LOT E : l'entrée de computeNextStep gagne un champ `disponibilites` (nombre de
// disponibilités de l'agenda). Les cas existants de tests/unit/publication.test.ts (qui n'ont pas ce champ)
// devront être mis à jour dans le même lot, sous peine de les voir basculer sur « disponibilites ».

const regles = () => import('../../server/services/vitrines-regles')

describe('NEXT_STEPS', () => {
  it('should order photo, service, disponibilites, realisation', () => {
    expect([...NEXT_STEPS]).toEqual(['photo', 'service', 'disponibilites', 'realisation'])
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

    expect(computeNextStep(etat)).toBe(attendu)
  })

  it('should walk the full ladder as the vitrine fills up', async () => {
    const { computeNextStep } = await regles()
    const etat = { hasPhoto: false, servicesActifs: 0, disponibilites: 0, realisationsActives: 0 }

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
            const etape = computeNextStep({ hasPhoto, servicesActifs, disponibilites, realisationsActives })
            expect(etape === null || (NEXT_STEPS as readonly string[]).includes(etape)).toBe(true)
          }
        }
      }
    }
  })
})
