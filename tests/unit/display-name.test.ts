import { describe, expect, it } from 'vitest'
import { TITRES, TITRE_LABELS, displayName } from '../../shared/vitrine'

// U3 — displayName(titre, prenom, nom)

describe('displayName (U3)', () => {
  it('should prefix the titre label to the first and last name', () => {
    expect(displayName('dr', 'Cabrel', 'Nguesso')).toBe('Dr Cabrel Nguesso')
  })

  it('should omit the prefix when there is no titre', () => {
    expect(displayName(null, 'Cabrel', 'Nguesso')).toBe('Cabrel Nguesso')
  })

  it.each(TITRES)('should use the public label of the titre "%s"', (titre) => {
    expect(displayName(titre, 'Marie', 'Ngo')).toBe(`${TITRE_LABELS[titre]} Marie Ngo`)
  })

  it('should render the "m" titre as "M." with its dot', () => {
    expect(displayName('m', 'Paul', 'Biya')).toBe('M. Paul Biya')
  })

  it('should trim surrounding spaces and never produce a double space', () => {
    expect(displayName('dr', '  Cabrel ', ' Nguesso  ')).toBe('Dr Cabrel Nguesso')
  })

  it('should skip an empty last name without leaving a trailing space', () => {
    expect(displayName('dr', 'Cabrel', '')).toBe('Dr Cabrel')
    expect(displayName(null, '', 'Nguesso')).toBe('Nguesso')
  })

  it('should return an empty string when nothing is provided', () => {
    expect(displayName(null, '', '')).toBe('')
  })

  it('should keep accents and compound names untouched', () => {
    expect(displayName('mme', 'Marie-Thérèse', 'Ékoumè Ndzié')).toBe('Mme Marie-Thérèse Ékoumè Ndzié')
  })
})
