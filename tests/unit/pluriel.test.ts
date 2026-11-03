import { describe, expect, it } from 'vitest'
import { accorder, libelleHeures } from '../../app/utils/pluriel'

describe('accorder', () => {
  it('garde le singulier pour 0 et 1', () => {
    expect(accorder(0, 'heure', 'heures')).toBe('heure')
    expect(accorder(1, 'heure', 'heures')).toBe('heure')
  })

  it('met le pluriel au-delà de 1', () => {
    expect(accorder(2, 'heure', 'heures')).toBe('heures')
    expect(accorder(24, 'heure', 'heures')).toBe('heures')
  })
})

describe('libelleHeures', () => {
  it('accorde le nom avec le nombre', () => {
    expect(libelleHeures(1)).toBe('1 heure')
    expect(libelleHeures(24)).toBe('24 heures')
  })
})
