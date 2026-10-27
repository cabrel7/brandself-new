import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LISTE_REORDER_MAX } from '../../shared/listes'
import {
  ANNEE_MAX,
  ANNEE_MIN,
  GALERIE_MAX,
  REALISATION_DESCRIPTION_MAX,
  REALISATION_LIEN_MAX,
  REALISATION_LIEU_MAX,
  REALISATION_ROLE_MAX,
  REALISATION_TITRE_MAX,
} from '../../shared/realisations'
import { schemaRealisationCreate, schemaRealisationReorder, schemaRealisationUpdate } from '../../shared/schemas/realisation'

// U18 — schémas Zod des réalisations (création, mise à jour partielle, réordonnancement) et partie « schéma »
// de S4-CA07, CA11, CA12, CA19, CA25 (image requise / non nulle) et CA28. La cohérence ENTRE champs (image
// principale hors galerie, vedette et visibilité) n'est pas vérifiée ici : elle l'est côté serveur sur l'état
// fusionné (realisations-regles.test.ts, realisations.test.ts).

const IMAGE = randomUUID()
const minimal = { titre: 'Unité de cathétérisme', imageMediaId: IMAGE }

interface Probleme {
  chemin: string
  message: string
}

function problemes(resultat: { success: boolean, error?: { issues: { path: PropertyKey[], message: string }[] } }): Probleme[] {
  if (resultat.success) return []
  return (resultat.error?.issues ?? []).map((i) => ({ chemin: i.path.map(String).join('.'), message: i.message }))
}

function champsEnErreur(resultat: Parameters<typeof problemes>[0]): string[] {
  return [...new Set(problemes(resultat).map((p) => p.chemin.split('.')[0] ?? ''))]
}

const uuids = (n: number) => Array.from({ length: n }, () => randomUUID())

describe('schemaRealisationCreate (U18)', () => {
  it('should apply the defaults: nulls, empty galerie, actif true, enVedette absent (automatic)', () => {
    const resultat = schemaRealisationCreate.safeParse(minimal)

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({
      titre: 'Unité de cathétérisme',
      description: null,
      imageMediaId: IMAGE,
      galerie: [],
      annee: null,
      lieu: null,
      role: null,
      lien: null,
      actif: true,
    })
    expect('enVedette' in (resultat.data ?? {})).toBe(false)
  })

  it('should keep an explicit enVedette (true and false) distinct from an absent one', () => {
    expect(schemaRealisationCreate.parse({ ...minimal, enVedette: true }).enVedette).toBe(true)
    expect(schemaRealisationCreate.parse({ ...minimal, enVedette: false }).enVedette).toBe(false)
  })

  it('should accept a complete valid payload and keep every value', () => {
    const galerie = uuids(3)
    const complet = {
      titre: 'Campagne de dépistage',
      description: 'Une campagne menée en 2024.',
      imageMediaId: IMAGE,
      galerie,
      annee: 2024,
      lieu: 'Douala',
      role: 'Coordination médicale',
      lien: 'https://chu-douala.cm/campagne',
      enVedette: true,
      actif: false,
    }

    expect(schemaRealisationCreate.parse(complet)).toEqual(complet)
  })

  describe('titre', () => {
    it('should trim the title', () => {
      expect(schemaRealisationCreate.parse({ ...minimal, titre: '  Bilan  ' }).titre).toBe('Bilan')
    })

    it.each([[''], ['   '], ['\t\n']])('should refuse the empty title %j', (titre) => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, titre }))).toEqual(['titre'])
    })

    it('should give the French message "Le titre est requis." for an empty title', () => {
      expect(problemes(schemaRealisationCreate.safeParse({ ...minimal, titre: '' }))).toEqual([{ chemin: 'titre', message: 'Le titre est requis.' }])
    })

    it('should refuse a missing, null or non-string title', () => {
      expect(schemaRealisationCreate.safeParse({ imageMediaId: IMAGE }).success).toBe(false)
      expect(schemaRealisationCreate.safeParse({ ...minimal, titre: null }).success).toBe(false)
      expect(schemaRealisationCreate.safeParse({ ...minimal, titre: 42 }).success).toBe(false)
    })

    it(`should accept ${REALISATION_TITRE_MAX} characters and refuse ${REALISATION_TITRE_MAX + 1}`, () => {
      expect(schemaRealisationCreate.safeParse({ ...minimal, titre: 'a'.repeat(REALISATION_TITRE_MAX) }).success).toBe(true)
      const trop = schemaRealisationCreate.safeParse({ ...minimal, titre: 'a'.repeat(REALISATION_TITRE_MAX + 1) })
      expect(problemes(trop)).toHaveLength(1)
      expect(problemes(trop)[0]?.chemin).toBe('titre')
      expect(problemes(trop)[0]?.message).toContain('100')
    })
  })

  describe('description', () => {
    it.each([[''], ['   '], [null]])('should turn the description %j into null', (description) => {
      expect(schemaRealisationCreate.parse({ ...minimal, description }).description).toBeNull()
    })

    it('should trim the description and keep its line breaks', () => {
      expect(schemaRealisationCreate.parse({ ...minimal, description: '  ligne 1\nligne 2  ' }).description).toBe('ligne 1\nligne 2')
    })

    it(`should accept ${REALISATION_DESCRIPTION_MAX} characters and refuse ${REALISATION_DESCRIPTION_MAX + 1}`, () => {
      expect(schemaRealisationCreate.safeParse({ ...minimal, description: 'a'.repeat(REALISATION_DESCRIPTION_MAX) }).success).toBe(true)
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, description: 'a'.repeat(REALISATION_DESCRIPTION_MAX + 1) }))).toEqual(['description'])
    })

    it('should refuse a non-string description', () => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, description: 12 }))).toEqual(['description'])
    })
  })

  describe('imageMediaId (S4-CA07)', () => {
    it('should refuse a missing image with the message "Ajoutez une image principale."', () => {
      const resultat = schemaRealisationCreate.safeParse({ titre: 'Sans image' })

      expect(problemes(resultat)).toEqual([{ chemin: 'imageMediaId', message: 'Ajoutez une image principale.' }])
    })

    it('should refuse an explicit null image with the very same message (it can not be removed)', () => {
      const resultat = schemaRealisationCreate.safeParse({ titre: 'Sans image', imageMediaId: null })

      expect(problemes(resultat)).toEqual([{ chemin: 'imageMediaId', message: 'Ajoutez une image principale.' }])
    })

    it.each([['abc'], [''], [42], [true], ['3f2b8c1e-9d4a-4e7b-8a61'], [{}]])('should refuse %j as an invalid image', (imageMediaId) => {
      const resultat = schemaRealisationCreate.safeParse({ titre: 'x', imageMediaId })

      expect(problemes(resultat)).toEqual([{ chemin: 'imageMediaId', message: 'Image invalide.' }])
    })
  })

  describe('galerie (S4-CA11)', () => {
    it.each([0, 1, GALERIE_MAX])('should accept %i images', (n) => {
      const galerie = uuids(n)

      expect(schemaRealisationCreate.parse({ ...minimal, galerie }).galerie).toEqual(galerie)
    })

    it('should keep the order of the array', () => {
      const galerie = uuids(5).sort().reverse()

      expect(schemaRealisationCreate.parse({ ...minimal, galerie }).galerie).toEqual(galerie)
    })

    it(`should refuse ${GALERIE_MAX + 1} images with "La galerie compte 6 images au maximum."`, () => {
      const resultat = schemaRealisationCreate.safeParse({ ...minimal, galerie: uuids(GALERIE_MAX + 1) })

      expect(problemes(resultat)).toEqual([{ chemin: 'galerie', message: 'La galerie compte 6 images au maximum.' }])
    })

    it('should refuse a duplicated image', () => {
      const [a] = uuids(1)
      const resultat = schemaRealisationCreate.safeParse({ ...minimal, galerie: [a, randomUUID(), a] })

      expect(champsEnErreur(resultat)).toEqual(['galerie'])
      expect(problemes(resultat)[0]?.message).toContain('une fois')
    })

    it('should point at the offending entry for a malformed identifier', () => {
      const resultat = schemaRealisationCreate.safeParse({ ...minimal, galerie: [randomUUID(), 'abc'] })

      expect(problemes(resultat)).toEqual([{ chemin: 'galerie.1', message: 'Image invalide.' }])
    })

    it.each([[null], ['abc'], [{}], [42]])('should refuse %j instead of an array', (galerie) => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, galerie }))).toEqual(['galerie'])
    })

    it('should NOT forbid the main image inside the gallery here (that rule needs the merged state, it belongs to the service)', () => {
      expect(schemaRealisationCreate.safeParse({ ...minimal, galerie: [IMAGE] }).success).toBe(true)
    })
  })

  describe('annee (S4-CA11)', () => {
    it.each([ANNEE_MIN, 2025, ANNEE_MAX])('should accept the year %i', (annee) => {
      expect(schemaRealisationCreate.parse({ ...minimal, annee }).annee).toBe(annee)
    })

    it('should accept null', () => {
      expect(schemaRealisationCreate.parse({ ...minimal, annee: null }).annee).toBeNull()
    })

    it.each([[ANNEE_MIN - 1], [ANNEE_MAX + 1], [2025.5], [0], [-2025], ['2025'], [Number.NaN], [Infinity], [true]])('should refuse the year %j', (annee) => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, annee }))).toEqual(['annee'])
    })
  })

  describe('lieu et rôle', () => {
    it.each(['lieu', 'role'])('should turn a blank %s into null and trim a filled one', (cle) => {
      expect(schemaRealisationCreate.parse({ ...minimal, [cle]: '   ' })[cle as 'lieu']).toBeNull()
      expect(schemaRealisationCreate.parse({ ...minimal, [cle]: '  Douala ' })[cle as 'lieu']).toBe('Douala')
    })

    it.each([
      ['lieu', REALISATION_LIEU_MAX],
      ['role', REALISATION_ROLE_MAX],
    ])('should accept %s of %i characters and refuse one more', (cle, max) => {
      expect(schemaRealisationCreate.safeParse({ ...minimal, [cle]: 'a'.repeat(max) }).success).toBe(true)
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, [cle]: 'a'.repeat(max + 1) }))).toEqual([cle])
    })
  })

  describe('lien (S4-CA11 et CA12)', () => {
    it.each([
      ['www.chu-douala.cm', 'https://www.chu-douala.cm'],
      ['chu-douala.cm/projet', 'https://chu-douala.cm/projet'],
      ['  https://x.cm/p  ', 'https://x.cm/p'],
      ['http://x.cm', 'http://x.cm'],
      ['https://x.cm/a?b=1#c', 'https://x.cm/a?b=1#c'],
      ['', null],
      ['   ', null],
      [null, null],
    ])('should turn %j into %j', (saisie, attendu) => {
      expect(schemaRealisationCreate.parse({ ...minimal, lien: saisie }).lien).toBe(attendu)
    })

    it('should accept an upper-case scheme (HTTP://X.CM)', () => {
      expect(schemaRealisationCreate.safeParse({ ...minimal, lien: 'HTTP://X.CM' }).success).toBe(true)
    })

    it.each([
      ['javascript:alert(1)'],
      ['JavaScript:alert(1)'],
      ['  javascript:alert(1)  '],
      ['javascript://x.cm/%0Aalert(1)'],
      ['data:text/html;base64,PHNjcmlwdD4='],
      ['vbscript:msgbox(1)'],
      ['ftp://x.cm'],
      ['file:///etc/passwd'],
      ['mailto:a@b.cm'],
      ['tel:+237600000000'],
      ['https://'],
      ['http://'],
      ['https://localhost'],
      ['http://exa mple.cm'],
      ['https://-x.cm'],
      ['x'],
    ])('should refuse the unsafe or malformed link %j (the XSS vector javascript: first)', (lien) => {
      const resultat = schemaRealisationCreate.safeParse({ ...minimal, lien })

      expect(problemes(resultat)).toHaveLength(1)
      expect(problemes(resultat)[0]?.chemin).toBe('lien')
      expect(problemes(resultat)[0]?.message).toContain('adresse web valide')
    })

    it.each([[123], [true], [{}], [['https://x.cm']]])('should refuse the non-string link %j', (lien) => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, lien }))).toEqual(['lien'])
    })

    it(`should accept a link of exactly ${REALISATION_LIEN_MAX} characters and refuse one more`, () => {
      const base = 'https://x.cm/'
      const limite = `${base}${'a'.repeat(REALISATION_LIEN_MAX - base.length)}`
      expect(limite).toHaveLength(REALISATION_LIEN_MAX)

      expect(schemaRealisationCreate.safeParse({ ...minimal, lien: limite }).success).toBe(true)
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, lien: `${limite}a` }))).toEqual(['lien'])
    })
  })

  describe('actif et enVedette', () => {
    it.each([['oui'], [1], [0], [null], ['true']])('should refuse %j as a boolean', (valeur) => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, actif: valeur }))).toEqual(['actif'])
      expect(champsEnErreur(schemaRealisationCreate.safeParse({ ...minimal, enVedette: valeur }))).toEqual(['enVedette'])
    })
  })

  describe('clés interdites (strict)', () => {
    it.each(['slug', 'ordre', 'vitrineId', 'id', 'createdAt', 'updatedAt', 'image', 'imageMediaID', 'inconnu'])('should refuse the key %s', (cle) => {
      expect(schemaRealisationCreate.safeParse({ ...minimal, [cle]: 'x' }).success).toBe(false)
    })

    it.each([[null], [[]], ['texte'], [42], [undefined]])('should refuse %j as a whole body', (corps) => {
      expect(schemaRealisationCreate.safeParse(corps).success).toBe(false)
    })

    it('should report the title and the image together for an empty body', () => {
      expect(champsEnErreur(schemaRealisationCreate.safeParse({})).sort()).toEqual(['imageMediaId', 'titre'])
    })
  })
})

describe('schemaRealisationUpdate (U18)', () => {
  it('should refuse an empty object with "Aucune modification à enregistrer." (S4-CA28)', () => {
    const resultat = schemaRealisationUpdate.safeParse({})

    expect(problemes(resultat)).toEqual([{ chemin: '', message: 'Aucune modification à enregistrer.' }])
  })

  it.each([
    ['titre', 'Nouveau'],
    ['description', 'Texte'],
    ['imageMediaId', IMAGE],
    ['galerie', uuids(2)],
    ['annee', 2020],
    ['lieu', 'Yaoundé'],
    ['role', 'Chef de projet'],
    ['lien', 'https://x.cm'],
    ['enVedette', true],
    ['actif', false],
  ])('should accept the field %s alone, and return only that field (no default applied)', (cle, valeur) => {
    const resultat = schemaRealisationUpdate.safeParse({ [cle]: valeur })

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({ [cle]: valeur })
  })

  it('should NOT invent a gallery, a link, a vedette or any default for the fields that are absent (absent = unchanged)', () => {
    const parsed = schemaRealisationUpdate.parse({ description: 'x' })

    expect(Object.keys(parsed)).toEqual(['description'])
    expect(parsed).not.toHaveProperty('galerie')
    expect(parsed).not.toHaveProperty('lien')
    expect(parsed).not.toHaveProperty('actif')
  })

  it('should accept an empty gallery (complete replacement by nothing)', () => {
    expect(schemaRealisationUpdate.parse({ galerie: [] })).toEqual({ galerie: [] })
  })

  it('should refuse a null image (400 imageMediaId, S4-CA19) while an image id is fine', () => {
    const resultat = schemaRealisationUpdate.safeParse({ imageMediaId: null })

    expect(problemes(resultat)).toEqual([{ chemin: 'imageMediaId', message: 'Ajoutez une image principale.' }])
  })

  it('should still allow clearing the optional fields with null or blank strings', () => {
    expect(schemaRealisationUpdate.parse({ description: '   ' })).toEqual({ description: null })
    expect(schemaRealisationUpdate.parse({ lien: '' })).toEqual({ lien: null })
    expect(schemaRealisationUpdate.parse({ annee: null })).toEqual({ annee: null })
    expect(schemaRealisationUpdate.parse({ lieu: null, role: '' })).toEqual({ lieu: null, role: null })
  })

  it('should normalise the link like the creation does', () => {
    expect(schemaRealisationUpdate.parse({ lien: 'www.chu-douala.cm' })).toEqual({ lien: 'https://www.chu-douala.cm' })
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ lien: 'javascript:alert(1)' }))).toEqual(['lien'])
  })

  it(`should refuse more than ${GALERIE_MAX} images and a duplicated image in the gallery`, () => {
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ galerie: uuids(GALERIE_MAX + 1) }))).toEqual(['galerie'])
    const [a] = uuids(1)
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ galerie: [a, a] }))).toEqual(['galerie'])
  })

  it('should refuse a null gallery (it is [] to empty it)', () => {
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ galerie: null }))).toEqual(['galerie'])
  })

  it('should apply the same bounds as the creation (title, description, year)', () => {
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ titre: '' }))).toEqual(['titre'])
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ titre: 'a'.repeat(REALISATION_TITRE_MAX + 1) }))).toEqual(['titre'])
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ description: 'a'.repeat(REALISATION_DESCRIPTION_MAX + 1) }))).toEqual(['description'])
    expect(champsEnErreur(schemaRealisationUpdate.safeParse({ annee: ANNEE_MAX + 1 }))).toEqual(['annee'])
  })

  it.each(['slug', 'ordre', 'vitrineId', 'id', 'createdAt'])('should refuse the forbidden key %s (strict)', (cle) => {
    expect(schemaRealisationUpdate.safeParse({ titre: 'x', [cle]: 'x' }).success).toBe(false)
  })
})

describe('schemaRealisationReorder (U18)', () => {
  it('should accept a list of uuids and keep its order', () => {
    const ids = uuids(4).sort().reverse()

    expect(schemaRealisationReorder.parse({ ids })).toEqual({ ids })
  })

  it('should refuse an empty list', () => {
    expect(champsEnErreur(schemaRealisationReorder.safeParse({ ids: [] }))).toEqual(['ids'])
  })

  it(`should accept ${LISTE_REORDER_MAX} identifiers and refuse ${LISTE_REORDER_MAX + 1}`, () => {
    expect(schemaRealisationReorder.safeParse({ ids: uuids(LISTE_REORDER_MAX) }).success).toBe(true)
    expect(champsEnErreur(schemaRealisationReorder.safeParse({ ids: uuids(LISTE_REORDER_MAX + 1) }))).toEqual(['ids'])
  })

  it('should refuse a duplicated identifier (400, not 422: the list can not even be a permutation)', () => {
    const [a] = uuids(1)

    expect(champsEnErreur(schemaRealisationReorder.safeParse({ ids: [a, a] }))).toEqual(['ids'])
  })

  it.each([[['abc']], [['']], [[42]], [[null]]])('should refuse the malformed identifiers %j', (ids) => {
    expect(champsEnErreur(schemaRealisationReorder.safeParse({ ids }))).toEqual(['ids'])
  })

  it.each([[{}], [{ ids: 'abc' }], [{ ids: null }], [null], [[]]])('should refuse the body %j', (corps) => {
    expect(schemaRealisationReorder.safeParse(corps).success).toBe(false)
  })

  it('should refuse an extra key (strict)', () => {
    expect(schemaRealisationReorder.safeParse({ ids: uuids(1), ordre: 3 }).success).toBe(false)
  })
})
