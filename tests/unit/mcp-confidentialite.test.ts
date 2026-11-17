import { describe, expect, it } from 'vitest'
import { MCP_CONTENU_VISITEUR_MAX, MCP_NOTE_CONTENU_VISITEUR, MCP_PRENOM_MAX } from '../../shared/mcp'
import { avecDetailVisiteur, contenuVisiteur, prenomInitiale } from '../../server/mcp/confidentialite'

describe('prenomInitiale (confidentialité par défaut)', () => {
  it.each([
    ['Marie Dupont', 'Marie D.'],
    ['Marie', 'Marie'],
    ['Jean  Paul Ngo', 'Jean P.'],
    ['  Marie   dupont  ', 'Marie D.'],
    ['', 'Visiteur'],
    ['   ', 'Visiteur'],
    ['Éloïse Émile', 'Éloïse É.'],
  ])('should turn %j into %j', (nom, attendu) => {
    expect(prenomInitiale(nom)).toBe(attendu)
  })

  it('should cap a long free-text first name so it cannot carry an instruction', () => {
    const sortie = prenomInitiale(`${'a'.repeat(120)} Dupont`)
    expect(sortie.split(' ')[0]).toHaveLength(MCP_PRENOM_MAX)
  })
})

describe('contenuVisiteur', () => {
  it('should wrap fields under contenu_visiteur with the fixed untrusted-data note', () => {
    const sortie = contenuVisiteur({ message: 'Bonjour', email: 'a@b.test' })
    expect(sortie).toEqual({
      contenu_visiteur: { message: 'Bonjour', email: 'a@b.test' },
      note_contenu_visiteur: MCP_NOTE_CONTENU_VISITEUR,
    })
  })

  it('should truncate every field to the maximum length', () => {
    const sortie = contenuVisiteur({ message: 'x'.repeat(MCP_CONTENU_VISITEUR_MAX + 200) })
    expect(sortie.contenu_visiteur.message).toHaveLength(MCP_CONTENU_VISITEUR_MAX)
  })

  it('should drop empty and null fields', () => {
    expect(contenuVisiteur({ message: null, note: '', email: 'a@b.test' }).contenu_visiteur).toEqual({ email: 'a@b.test' })
  })
})

describe('avecDetailVisiteur', () => {
  it('should return nothing when the detail is not authorised', () => {
    expect(avecDetailVisiteur(false, { message: 'secret' })).toEqual({})
  })

  it('should return nothing when authorised but every field is empty', () => {
    expect(avecDetailVisiteur(true, { message: null })).toEqual({})
  })

  it('should return the wrapped content when authorised', () => {
    expect(avecDetailVisiteur(true, { message: 'Bonjour' })).toMatchObject({ contenu_visiteur: { message: 'Bonjour' } })
  })
})
