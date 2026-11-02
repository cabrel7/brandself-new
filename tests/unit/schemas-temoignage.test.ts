import { describe, expect, it } from 'vitest'
import {
  schemaTemoignageCreate,
  schemaTemoignageParams,
  schemaTemoignageUpdate,
} from '../../shared/schemas/temoignage'

describe('schémas témoignage', () => {
  it('applique les valeurs par défaut uniquement à la création', () => {
    expect(schemaTemoignageCreate.parse({
      slug: 'avis-alice',
      auteur: 'Alice',
      texte: 'Un accompagnement très humain.',
    })).toEqual({
      slug: 'avis-alice',
      auteur: 'Alice',
      texte: 'Un accompagnement très humain.',
      enVedette: false,
      ordre: 0,
      actif: true,
    })
  })

  it('ne réinjecte aucun défaut dans un patch limité au texte', () => {
    expect(schemaTemoignageUpdate.parse({ texte: 'Texte corrigé.' })).toEqual({ texte: 'Texte corrigé.' })
  })

  it('refuse slug, ordre et tout autre champ dans une mise à jour', () => {
    expect(schemaTemoignageUpdate.safeParse({ slug: 'nouveau-slug' }).success).toBe(false)
    expect(schemaTemoignageUpdate.safeParse({ ordre: 4 }).success).toBe(false)
    expect(schemaTemoignageUpdate.safeParse({ texte: 'Valide', inconnu: true }).success).toBe(false)
  })

  it('valide et normalise le paramètre slug de la route', () => {
    expect(schemaTemoignageParams.parse({ slug: '  Avis-Alice  ' })).toEqual({ slug: 'avis-alice' })
    expect(schemaTemoignageParams.safeParse({ slug: 'avis invalide' }).success).toBe(false)
  })
})
