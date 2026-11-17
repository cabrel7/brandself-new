import { describe, expect, it } from 'vitest'
import { premierASelectionner, voisinsMessage } from '../../app/composables/useStudioMessages'

const liste = ['a', 'b', 'c'].map((id) => ({ id, luLe: '2026-11-01T10:00:00.000Z' as string | null }))

describe('voisinsMessage', () => {
  it('premier : pas de précédent, suivant présent, position 1', () => {
    expect(voisinsMessage(liste, 'a')).toEqual({ precedent: null, suivant: 'b', position: 1, total: 3 })
  })

  it('milieu : précédent et suivant présents', () => {
    expect(voisinsMessage(liste, 'b')).toEqual({ precedent: 'a', suivant: 'c', position: 2, total: 3 })
  })

  it('dernier : pas de suivant, position = total', () => {
    expect(voisinsMessage(liste, 'c')).toEqual({ precedent: 'b', suivant: null, position: 3, total: 3 })
  })

  it('un seul message : aucun voisin', () => {
    expect(voisinsMessage([liste[0]!], 'a')).toEqual({ precedent: null, suivant: null, position: 1, total: 1 })
  })

  it('identifiant inconnu ou null : aucun voisin, position 0, total conservé', () => {
    expect(voisinsMessage(liste, 'zzz')).toEqual({ precedent: null, suivant: null, position: 0, total: 3 })
    expect(voisinsMessage(liste, null)).toEqual({ precedent: null, suivant: null, position: 0, total: 3 })
  })

  it('liste vide : tout à zéro', () => {
    expect(voisinsMessage([], 'a')).toEqual({ precedent: null, suivant: null, position: 0, total: 0 })
  })
})

describe('premierASelectionner', () => {
  it('retient le premier message non lu', () => {
    const messages = [
      { id: 'a', luLe: 'x' },
      { id: 'b', luLe: null },
      { id: 'c', luLe: null },
    ]
    expect(premierASelectionner(messages)).toBe('b')
  })

  it('retient le premier message si tout est lu', () => {
    expect(premierASelectionner(liste)).toBe('a')
  })

  it('renvoie null si la liste est vide', () => {
    expect(premierASelectionner([])).toBeNull()
  })
})
