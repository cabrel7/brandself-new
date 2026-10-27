import { afterEach, describe, expect, it, vi } from 'vitest'
import { VEDETTE_MAX } from '../../shared/listes'
import {
  ANNEE_MAX,
  ANNEE_MIN,
  AUTRES_REALISATIONS_MAX,
  GALERIE_MAX,
  REALISATION_FAITS_LIBELLES,
  REALISATION_SLUG_REPLI,
  anneeCourante,
  libelleVedetteRealisations,
  metaRealisation,
  metaRealisationStudio,
  normaliserLien,
  realisationDetailHref,
  realisationsHref,
  resumeListeRealisations,
  surtitreRealisation,
} from '../../shared/realisations'

// U21 — constantes, libellés et fonctions pures des réalisations (shared/realisations.ts).
const MOTS_INTERDITS = /\b(espace|bloc|module|widget|section)s?\b/i

describe('constantes (U21)', () => {
  it('should pin the bounds that the migration 0011 and the schemas rely on', () => {
    expect([ANNEE_MIN, ANNEE_MAX, GALERIE_MAX, AUTRES_REALISATIONS_MAX, VEDETTE_MAX]).toEqual([1900, 2100, 6, 2, 3])
    expect(REALISATION_SLUG_REPLI).toBe('realisation')
  })

  it('should label the three public facts "Année", "Lieu" and "Rôle" (the page speaks to the visitor, never "Votre rôle", decision #55)', () => {
    expect(REALISATION_FAITS_LIBELLES).toEqual({ annee: 'Année', lieu: 'Lieu', role: 'Rôle' })
  })

  it('should not use a forbidden user-facing word in any label (CLAUDE.md section 2)', () => {
    for (const libelle of Object.values(REALISATION_FAITS_LIBELLES)) {
      expect(libelle).not.toMatch(MOTS_INTERDITS)
    }
  })
})

describe('normaliserLien (U21, S4-CA12)', () => {
  it.each([
    ['www.chu-douala.cm', 'https://www.chu-douala.cm'],
    ['  https://x.cm/p  ', 'https://x.cm/p'],
    ['http://x.cm', 'http://x.cm'],
    ['HTTP://X.CM', 'HTTP://X.CM'],
    ['x.cm', 'https://x.cm'],
    ['', null],
    ['   ', null],
    ['\t\n', null],
  ])('should turn %j into %j', (saisie, attendu) => {
    expect(normaliserLien(saisie)).toBe(attendu)
  })

  it('should leave a value with a scheme alone, whatever the scheme (the schema refuses the unsafe ones, not this helper)', () => {
    expect(normaliserLien('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(normaliserLien('mailto:a@b.cm')).toBe('mailto:a@b.cm')
  })

  it.each([[null], [undefined], [12], [true], [{}], [['a']]])('should return the non-string value %j untouched', (valeur) => {
    expect(normaliserLien(valeur)).toBe(valeur)
  })
})

describe('metaRealisation (U21)', () => {
  it.each([
    [{ annee: 2025, lieu: 'Douala' }, '2025 · Douala'],
    [{ annee: 2025, lieu: null }, '2025'],
    [{ annee: null, lieu: 'Douala' }, 'Douala'],
    [{ annee: null, lieu: null }, ''],
    [{ annee: 2025, lieu: '' }, '2025'],
    [{ annee: null, lieu: '' }, ''],
  ])('should write %j as %j', (source, attendu) => {
    expect(metaRealisation(source)).toBe(attendu)
  })
})

describe('metaRealisationStudio (U21)', () => {
  it('should be the plain meta for a visible realisation', () => {
    expect(metaRealisationStudio({ annee: 2025, lieu: 'CHU de Douala', actif: true })).toBe('2025 · CHU de Douala')
    expect(metaRealisationStudio({ annee: null, lieu: null, actif: true })).toBe('')
  })

  it.each([
    [{ annee: 2025, lieu: 'CHU de Douala', actif: false }, '2025 · CHU de Douala · Masqué'],
    [{ annee: 2025, lieu: null, actif: false }, '2025 · Masqué'],
    [{ annee: null, lieu: 'Douala', actif: false }, 'Douala · Masqué'],
    [{ annee: null, lieu: null, actif: false }, 'Masqué'],
  ])('should suffix a masked realisation: %j -> %j', (source, attendu) => {
    expect(metaRealisationStudio(source)).toBe(attendu)
  })
})

describe('surtitreRealisation (U21)', () => {
  it('should write "Réalisation · 2025" with a year and "Réalisation" without', () => {
    expect(surtitreRealisation(2025)).toBe('Réalisation · 2025')
    expect(surtitreRealisation(null)).toBe('Réalisation')
  })
})

describe('resumeListeRealisations (U21, S4-CA48)', () => {
  it.each([
    [4, 2, 3, '4 visibles · 2 en vedette sur 3'],
    [3, 2, 3, '3 visibles · 2 en vedette sur 3'],
    [2, 0, 3, '2 visibles · 0 en vedette sur 3'],
    [1, 1, 3, '1 visible · 1 en vedette sur 3'],
    [0, 0, 3, '0 visible · 0 en vedette sur 3'],
  ])('should summarise %i visible, %i vedette on %i as %j', (visibles, enVedette, max, attendu) => {
    expect(resumeListeRealisations(visibles, enVedette, max)).toBe(attendu)
  })

  it('should use the max it receives', () => {
    expect(resumeListeRealisations(5, 1, 5)).toBe('5 visibles · 1 en vedette sur 5')
  })
})

describe('libelleVedetteRealisations (U21, S4-CA49)', () => {
  it.each([
    [0, '0 réalisation sur 3 en vedette.'],
    [1, '1 réalisation sur 3 en vedette.'],
    [2, '2 réalisations sur 3 en vedette.'],
    [3, '3 réalisations sur 3 en vedette.'],
  ])('should write %i as %j', (n, attendu) => {
    expect(libelleVedetteRealisations(n, 3)).toBe(attendu)
  })
})

describe('liens internes (U21)', () => {
  it('should build the list and detail hrefs of a vitrine', () => {
    expect(realisationsHref('dr-cabrel')).toBe('/dr-cabrel/realisations')
    expect(realisationDetailHref('dr-cabrel', 'unite-de-catheterisme')).toBe('/dr-cabrel/realisations/unite-de-catheterisme')
  })
})

describe('anneeCourante (U21, S4-CA49)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should answer the current year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-06-15T12:00:00.000Z'))

    expect(anneeCourante()).toBe(2031)
  })

  it('should always sit inside the accepted range, so the pre-filled year of the form is never refused', () => {
    expect(anneeCourante()).toBeGreaterThanOrEqual(ANNEE_MIN)
    expect(anneeCourante()).toBeLessThanOrEqual(ANNEE_MAX)
  })
})
