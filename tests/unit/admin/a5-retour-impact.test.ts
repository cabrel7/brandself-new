import { describe, expect, it } from 'vitest'
import type { ImpactPlan } from '../../../shared/schemas/admin-versions'
import { corpsRetourVersion } from '../../../app/utils/admin-versions'

const IMPACT: ImpactPlan = {
  services: { comptes: 2, elementsMasques: 4 },
  realisations: { comptes: 0, elementsMasques: 0 },
  temoignages: { comptes: 0, elementsMasques: 0 },
  reservationsMois: { comptes: 1 },
  generationsIaMois: { comptes: 0 },
}

describe('corps d\'un retour arrière', () => {
  it('ne contient que le motif tant que le serveur n\'a pas présenté d\'impact', () => {
    expect(corpsRetourVersion('Erreur de limite', null)).toEqual({ motif: 'Erreur de limite' })
  })

  it('renvoie l\'impact acquitté après un 409 IMPACT_CHANGE', () => {
    expect(corpsRetourVersion('Erreur de limite', IMPACT)).toEqual({ impactAcquitte: IMPACT, motif: 'Erreur de limite' })
  })
})
