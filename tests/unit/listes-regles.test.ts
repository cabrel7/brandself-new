import { describe, expect, it } from 'vitest'
import { LISTE_SLUG_MAX, LISTE_SLUG_REGEX } from '../../shared/listes'

// U20 — règles communes à toutes les listes d'une vitrine (server/services/listes-regles.ts), extraites de
// services-regles.ts par la factorisation S4 (décision #58) : aucune base, aucun réseau.
// Imports paresseux : module absent en phase RED = échec propre de chaque test.
//
// CONTRAT ATTENDU :
//   resolveEnVedette({ demande, actif, autresEnVedette, max }) -> boolean | 'COMPLET'
//   computeALaUne(visibles, max)                               -> sous-ensemble ordonné (mêmes objets), vedettes sinon les `max` premiers
//   computeCompteurs(lignes, max)                              -> { total, visibles, enVedette, vedetteMax }
//   slugFromText(texte, { max, repli })                        -> slug <= max caractères, sans tiret final, `repli` si rien d'exploitable
//   pickAvailableSlug(base, existants: ReadonlySet<string>, max) -> `base`, sinon `base-2`, `base-3`… (<= max caractères)
// et services-regles.ts RÉ-EXPORTE resolveEnVedette, computeALaUne et computeCompteurs (mêmes fonctions).
const regles = () => import('../../server/services/listes-regles')
const reglesServices = () => import('../../server/services/services-regles')

describe('resolveEnVedette (U20)', () => {
  it.each([
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [4, false],
  ])('should decide automatically (demande absente) with %i other vedettes on 3: %j', async (autresEnVedette, attendu) => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: undefined, actif: true, autresEnVedette, max: 3 })).toBe(attendu)
  })

  it('should never choose a vedette automatically for a masked item', async () => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: undefined, actif: false, autresEnVedette: 0, max: 3 })).toBe(false)
  })

  it('should honour an explicit false even when there is room or when it is full', async () => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: false, actif: true, autresEnVedette: 0, max: 3 })).toBe(false)
    expect(resolveEnVedette({ demande: false, actif: true, autresEnVedette: 3, max: 3 })).toBe(false)
  })

  it.each([0, 1, 2])('should accept an explicit true with %i other vedettes on 3', async (autresEnVedette) => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette, max: 3 })).toBe(true)
  })

  it.each([3, 4, 10])('should answer COMPLET for an explicit true with %i other vedettes on 3', async (autresEnVedette) => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette, max: 3 })).toBe('COMPLET')
  })

  it('should use the max it receives (not a hard-coded 3)', async () => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette: 1, max: 1 })).toBe('COMPLET')
    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette: 4, max: 5 })).toBe(true)
    expect(resolveEnVedette({ demande: undefined, actif: true, autresEnVedette: 0, max: 0 })).toBe(false)
  })
})

describe('computeALaUne (U20)', () => {
  const ligne = (slug: string, enVedette = false) => ({ slug, enVedette })

  it('should return the vedettes in order when there are some', async () => {
    const { computeALaUne } = await regles()
    const visibles = [ligne('a'), ligne('b', true), ligne('c'), ligne('d', true), ligne('e')]

    expect(computeALaUne(visibles, 3).map((l) => l.slug)).toEqual(['b', 'd'])
  })

  it('should fall back to the first three visible items when none is a vedette', async () => {
    const { computeALaUne } = await regles()

    expect(computeALaUne(['a', 'b', 'c', 'd', 'e'].map((s) => ligne(s)), 3).map((l) => l.slug)).toEqual(['a', 'b', 'c'])
  })

  it('should return every visible item when there are fewer than the max and no vedette', async () => {
    const { computeALaUne } = await regles()

    expect(computeALaUne([ligne('a'), ligne('b')], 3).map((l) => l.slug)).toEqual(['a', 'b'])
  })

  it('should return an empty list for no visible item', async () => {
    const { computeALaUne } = await regles()

    expect(computeALaUne([], 3)).toEqual([])
  })

  it('should never return more than max entries, even if the data holds too many vedettes', async () => {
    const { computeALaUne } = await regles()

    expect(computeALaUne(['a', 'b', 'c', 'd', 'e'].map((s) => ligne(s, true)), 3).map((l) => l.slug)).toEqual(['a', 'b', 'c'])
  })

  it('should return the same objects it received (no copy) and leave the input untouched', async () => {
    const { computeALaUne } = await regles()
    const visibles = [ligne('a', true), ligne('b')]
    const copie = structuredClone(visibles)

    const resultat = computeALaUne(visibles, 3)

    expect(resultat[0]).toBe(visibles[0])
    expect(visibles).toEqual(copie)
  })
})

describe('computeCompteurs (U20)', () => {
  it('should count total, visible and vedette items and carry the max', async () => {
    const { computeCompteurs } = await regles()
    const lignes = [
      { actif: true, enVedette: true },
      { actif: true, enVedette: true },
      { actif: true, enVedette: true },
      { actif: true, enVedette: false },
      { actif: true, enVedette: false },
      { actif: false, enVedette: false },
    ]

    expect(computeCompteurs(lignes, 3)).toEqual({ total: 6, visibles: 5, enVedette: 3, vedetteMax: 3 })
  })

  it('should answer zeros for no item', async () => {
    const { computeCompteurs } = await regles()

    expect(computeCompteurs([], 3)).toEqual({ total: 0, visibles: 0, enVedette: 0, vedetteMax: 3 })
  })

  it('should count masked items as total only', async () => {
    const { computeCompteurs } = await regles()

    expect(computeCompteurs([{ actif: false, enVedette: false }, { actif: false, enVedette: false }], 3)).toEqual({ total: 2, visibles: 0, enVedette: 0, vedetteMax: 3 })
  })

  it('should carry any max it receives', async () => {
    const { computeCompteurs } = await regles()

    expect(computeCompteurs([], 7).vedetteMax).toBe(7)
  })
})

describe('slugFromText (U20, repli et max paramétrés)', () => {
  const OPTIONS = { max: LISTE_SLUG_MAX, repli: 'realisation' }

  it.each([
    ['Unité de cathétérisme, CHU de Douala', 'unite-de-catheterisme-chu-de-douala'],
    ['Dépistage cœur & poumons', 'depistage-coeur-et-poumons'],
    ['Café & Thé', 'cafe-et-the'],
    ['Œuvre', 'oeuvre'],
    ['  Bilan   complet  ', 'bilan-complet'],
    ['100% santé', '100-sante'],
  ])('should turn %j into %j', async (texte, attendu) => {
    const { slugFromText } = await regles()

    expect(slugFromText(texte, OPTIONS)).toBe(attendu)
  })

  it('should not split camel case (decamelize disabled)', async () => {
    const { slugFromText } = await regles()

    expect(slugFromText('MonProjet', OPTIONS)).toBe('monprojet')
  })

  it.each([[''], ['   '], ['!!!'], ['—'], ['你好'], ['​']])('should fall back to the repli it receives for %j', async (texte) => {
    const { slugFromText } = await regles()

    expect(slugFromText(texte, { max: LISTE_SLUG_MAX, repli: 'realisation' })).toBe('realisation')
    expect(slugFromText(texte, { max: LISTE_SLUG_MAX, repli: 'service' })).toBe('service')
    expect(slugFromText(texte, { max: LISTE_SLUG_MAX, repli: 'temoignage' })).toBe('temoignage')
  })

  it('should cut at the max it receives without a trailing dash', async () => {
    const { slugFromText } = await regles()
    // Mots de 9 lettres : la coupe à 20 tombe sur un tiret (10 caractères par unité).
    const texte = 'abcdefghi '.repeat(6)

    const slug = slugFromText(texte, { max: 20, repli: 'x' })

    expect(slug.length).toBeLessThanOrEqual(20)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toBe('abcdefghi-abcdefghi')
  })

  it('should honour a max larger or smaller than 80 (not a hard-coded limit)', async () => {
    const { slugFromText } = await regles()
    const texte = 'mot '.repeat(60)

    expect(slugFromText(texte, { max: 120, repli: 'x' }).length).toBeGreaterThan(LISTE_SLUG_MAX)
    expect(slugFromText(texte, { max: 10, repli: 'x' }).length).toBeLessThanOrEqual(10)
  })

  it('should accept a very long accented text without throwing and stay within the limit', async () => {
    const { slugFromText } = await regles()

    const slug = slugFromText('é'.repeat(5000), OPTIONS)

    expect(slug.length).toBeLessThanOrEqual(LISTE_SLUG_MAX)
    expect(slug).toMatch(LISTE_SLUG_REGEX)
  })

  it('should always produce a slug accepted by the database CHECK, whatever the text', async () => {
    const { slugFromText } = await regles()
    const textes = ['<script>alert(1)</script>', "'; DROP TABLE realisations;--", '../../etc/passwd', 'Tab\tet\nsaut', '🎉 Atelier 🎉', 'Ça va ? Oui !', 'a'.repeat(200)]

    for (const texte of textes) {
      expect(slugFromText(texte, OPTIONS)).toMatch(LISTE_SLUG_REGEX)
    }
  })
})

describe('pickAvailableSlug (U20, max paramétré)', () => {
  it('should return the base when it is free', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set(), LISTE_SLUG_MAX)).toBe('bilan')
    expect(pickAvailableSlug('bilan', new Set(['autre']), LISTE_SLUG_MAX)).toBe('bilan')
  })

  it('should suffix -2 then -3 when the base is taken, and reuse the first free number', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set(['bilan']), LISTE_SLUG_MAX)).toBe('bilan-2')
    expect(pickAvailableSlug('bilan', new Set(['bilan', 'bilan-2']), LISTE_SLUG_MAX)).toBe('bilan-3')
    expect(pickAvailableSlug('bilan', new Set(['bilan', 'bilan-3']), LISTE_SLUG_MAX)).toBe('bilan-2')
  })

  it('should not suffix when only a suffixed variant exists', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set(['bilan-2']), LISTE_SLUG_MAX)).toBe('bilan')
  })

  it('should not mutate the set of existing slugs', async () => {
    const { pickAvailableSlug } = await regles()
    const existants = new Set(['bilan'])

    pickAvailableSlug('bilan', existants, LISTE_SLUG_MAX)

    expect([...existants]).toEqual(['bilan'])
  })

  it('should keep the result within the max it receives by shortening the base, even when the base already has max characters', async () => {
    const { pickAvailableSlug } = await regles()

    for (const max of [20, LISTE_SLUG_MAX]) {
      const base = 'a'.repeat(max)

      const slug = pickAvailableSlug(base, new Set([base]), max)

      expect(slug.length).toBeLessThanOrEqual(max)
      expect(slug).toMatch(LISTE_SLUG_REGEX)
      expect(slug.endsWith('-2')).toBe(true)
      expect(slug).not.toBe(base)
    }
  })

  it('should never leave a double dash when shortening cuts the base right after a dash', async () => {
    const { pickAvailableSlug } = await regles()
    const base = `${'a'.repeat(77)}-bb`
    expect(base).toHaveLength(LISTE_SLUG_MAX)

    const slug = pickAvailableSlug(base, new Set([base]), LISTE_SLUG_MAX)

    expect(slug).toMatch(LISTE_SLUG_REGEX)
    expect(slug.length).toBeLessThanOrEqual(LISTE_SLUG_MAX)
  })

  it('should find a free slug among many taken ones, each result distinct and valid', async () => {
    const { pickAvailableSlug } = await regles()
    const existants = new Set<string>()

    for (let i = 0; i < 25; i += 1) {
      const slug = pickAvailableSlug('realisation', existants, LISTE_SLUG_MAX)
      expect(existants.has(slug)).toBe(false)
      expect(slug).toMatch(LISTE_SLUG_REGEX)
      existants.add(slug)
    }
    expect(existants.size).toBe(25)
    expect(existants.has('realisation-25')).toBe(true)
  })
})

describe('factorisation avec services-regles (U20, décision #58)', () => {
  it('should be the very same functions that services-regles re-exports (one source of truth, S3 behaviour unchanged)', async () => {
    const communes = await regles()
    const services = await reglesServices()

    expect(services.resolveEnVedette).toBe(communes.resolveEnVedette)
    expect(services.computeALaUne).toBe(communes.computeALaUne)
    expect(services.computeCompteurs).toBe(communes.computeCompteurs)
  })

  it('should keep the S3 wrappers on the service defaults: repli "service" and the 80-character limit', async () => {
    const services = await reglesServices()

    expect(services.slugFromTitle('!!!')).toBe('service')
    expect(services.slugFromTitle('Échographie cœur & poumons')).toBe('echographie-coeur-et-poumons')
    expect(services.pickAvailableSlug('bilan', new Set(['bilan']))).toBe('bilan-2')
  })
})
