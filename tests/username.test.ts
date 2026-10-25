import { describe, expect, it } from 'vitest'
import { validateUsername } from '../shared/schemas/username'

describe('validateUsername', () => {
  it.each(['dr-cabrel', 'marie-jeanne-237', 'jean-luc'])('accepts %s', (value) => {
    expect(validateUsername(value).success).toBe(true)
  })

  it('normalizes to lowercase', () => {
    const result = validateUsername('DR-Cabrel')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('dr-cabrel')
    }
  })

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(31), 'too long'],
    ['-abc', 'hyphen at start'],
    ['abc-', 'hyphen at end'],
    ['a--b', 'double hyphen'],
    ['dr cabrel', 'space'],
    ['dr_cabrel', 'underscore'],
    ['dr.cabrel', 'dot'],
  ])('refuses %s (%s)', (value) => {
    expect(validateUsername(value).success).toBe(false)
  })

  it.each(['api', 'studio', 'connexion', 'tarifs', 'admin'])(
    'refuses reserved word %s',
    (value) => {
      const result = validateUsername(value)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('réservé')
      }
    },
  )

  it('refuses reserved word « l » (too short for reserved message, refused anyway)', () => {
    expect(validateUsername('l').success).toBe(false)
  })
})
