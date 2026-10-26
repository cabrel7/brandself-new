import { describe, expect, it } from 'vitest'
import { PUBLICATION_REQUIRED_FIELDS } from '../../shared/vitrine'

// U6 — fonctions pures de server/services/vitrines.ts.
// Import paresseux : tant que le module n'existe pas, chaque test échoue pour la bonne raison.
const vitrinesService = () => import('../../server/services/vitrines')

const complete = { prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', ville: 'Douala', pays: 'CM' }

describe('computeMissingForPublication (U6)', () => {
  it('should return nothing for a complete vitrine', async () => {
    const { computeMissingForPublication } = await vitrinesService()

    expect(computeMissingForPublication(complete)).toEqual([])
  })

  it('should list ville and pays when both are null', async () => {
    const { computeMissingForPublication } = await vitrinesService()

    expect(computeMissingForPublication({ ...complete, ville: null, pays: null })).toEqual(['ville', 'pays'])
  })

  it.each(PUBLICATION_REQUIRED_FIELDS)('should report %s when it is null', async (champ) => {
    const { computeMissingForPublication } = await vitrinesService()

    expect(computeMissingForPublication({ ...complete, [champ]: null })).toEqual([champ])
  })

  it.each(['', '   '])('should treat the blank value %j as missing', async (vide) => {
    const { computeMissingForPublication } = await vitrinesService()

    expect(computeMissingForPublication({ ...complete, ville: vide })).toEqual(['ville'])
  })

  it('should list all five fields, in the canonical order, when everything is missing', async () => {
    const { computeMissingForPublication } = await vitrinesService()

    const manquants = computeMissingForPublication({ prenom: '', nom: '', metier: '', ville: null, pays: null })

    expect(manquants).toEqual([...PUBLICATION_REQUIRED_FIELDS])
  })

  it('should not ask for the photo, the accroche or the bio (not required to publish)', async () => {
    const { computeMissingForPublication } = await vitrinesService()

    expect(computeMissingForPublication({ ...complete, accroche: null, bio: null, photoMediaId: null } as never)).toEqual([])
  })
})

describe('computeNextStep (U6)', () => {
  it.each([
    [{ hasPhoto: false, servicesActifs: 0, realisationsActives: 0 }, 'photo'],
    [{ hasPhoto: false, servicesActifs: 3, realisationsActives: 3 }, 'photo'],
    [{ hasPhoto: true, servicesActifs: 0, realisationsActives: 0 }, 'service'],
    [{ hasPhoto: true, servicesActifs: 0, realisationsActives: 4 }, 'service'],
    [{ hasPhoto: true, servicesActifs: 1, realisationsActives: 0 }, 'realisation'],
    [{ hasPhoto: true, servicesActifs: 5, realisationsActives: 0 }, 'realisation'],
    [{ hasPhoto: true, servicesActifs: 1, realisationsActives: 1 }, null],
    [{ hasPhoto: true, servicesActifs: 9, realisationsActives: 9 }, null],
  ])('should answer for %j', async (etat, attendu) => {
    const { computeNextStep } = await vitrinesService()

    expect(computeNextStep(etat)).toBe(attendu)
  })
})
