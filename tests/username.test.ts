import { describe, expect, it } from 'vitest'
import { validerUsername } from '../shared/schemas/username'

describe('validerUsername', () => {
  it.each(['dr-cabrel', 'marie-jeanne-237', 'jean-luc'])('accepte %s', (valeur) => {
    expect(validerUsername(valeur).success).toBe(true)
  })

  it('normalise en minuscules', () => {
    const resultat = validerUsername('DR-Cabrel')
    expect(resultat.success).toBe(true)
    if (resultat.success) {
      expect(resultat.data).toBe('dr-cabrel')
    }
  })

  it.each([
    ['ab', 'trop court'],
    ['a'.repeat(31), 'trop long'],
    ['-abc', 'tiret en début'],
    ['abc-', 'tiret en fin'],
    ['a--b', 'double tiret'],
    ['dr cabrel', 'espace'],
    ['dr_cabrel', 'underscore'],
    ['dr.cabrel', 'point'],
  ])('refuse %s (%s)', (valeur) => {
    expect(validerUsername(valeur).success).toBe(false)
  })

  it.each(['api', 'studio', 'connexion', 'tarifs', 'admin'])(
    'refuse le mot réservé %s',
    (valeur) => {
      const resultat = validerUsername(valeur)
      expect(resultat.success).toBe(false)
      if (!resultat.success) {
        expect(resultat.error.issues[0].message).toContain('réservé')
      }
    },
  )

  it("refuse le mot réservé « l » (trop court pour le message réservé, refusé quand même)", () => {
    expect(validerUsername('l').success).toBe(false)
  })
})
