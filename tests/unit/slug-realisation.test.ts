import { describe, expect, it } from 'vitest'
import { LISTE_SLUG_MAX, LISTE_SLUG_REGEX } from '../../shared/listes'

// U23 — génération des slugs de réalisation (S4-CA10, décision #52).
// Imports paresseux : module absent en phase RED = échec propre de chaque test.
//
// CONTRAT ATTENDU : server/services/realisations-regles.ts
//   slugFromTitreRealisation(titre: string): string   (80 caractères au plus, sans tiret final, repli 'realisation')
// L'unicité par vitrine reste portée par pickAvailableSlug de listes-regles (max 80), voir listes-regles.test.ts.
const regles = () => import('../../server/services/realisations-regles')
const communes = () => import('../../server/services/listes-regles')

describe('slugFromTitreRealisation (U23)', () => {
  it.each([
    ['Unité de cathétérisme, CHU de Douala', 'unite-de-catheterisme-chu-de-douala'],
    ['Dépistage cœur & poumons', 'depistage-coeur-et-poumons'],
    ['Campagne de dépistage de l’hypertension', 'campagne-de-depistage-de-l-hypertension'],
    ['Programme de réadaptation cardiaque', 'programme-de-readaptation-cardiaque'],
    ['Café & Thé', 'cafe-et-the'],
    ['Œuvre', 'oeuvre'],
    ['ÉCHOGRAPHIE 2024', 'echographie-2024'],
    ['Bilan   complet  ', 'bilan-complet'],
    ['Rendez-vous -- spécial', 'rendez-vous-special'],
    ['a_b', 'a-b'],
  ])('should turn %j into %j', async (titre, attendu) => {
    const { slugFromTitreRealisation } = await regles()

    expect(slugFromTitreRealisation(titre)).toBe(attendu)
  })

  it('should not split camel case (decamelize disabled)', async () => {
    const { slugFromTitreRealisation } = await regles()

    expect(slugFromTitreRealisation('MonProjet')).toBe('monprojet')
  })

  it.each([[''], ['   '], ['!!!'], ['???'], ['—'], ['你好'], ['​']])('should fall back to "realisation" (not "service") for the title %j', async (titre) => {
    const { slugFromTitreRealisation } = await regles()

    expect(slugFromTitreRealisation(titre)).toBe('realisation')
  })

  it('should never exceed 80 characters nor end with a dash for a 100-character accented title (S4-CA10)', async () => {
    const { slugFromTitreRealisation } = await regles()
    const titre = 'Électrocardiogramme d’effort '.repeat(5).slice(0, 100)
    expect(titre).toHaveLength(100)

    const slug = slugFromTitreRealisation(titre)

    expect(slug.length).toBeLessThanOrEqual(LISTE_SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toMatch(LISTE_SLUG_REGEX)
    expect(slug.startsWith('electrocardiogramme-d-effort-electrocardiogramme-')).toBe(true)
  })

  it('should cut on a dash boundary without leaving a trailing dash when the 80th character falls on it', async () => {
    const { slugFromTitreRealisation } = await regles()
    // 8 mots de 9 lettres : la coupe à 80 tombe juste après un tiret (10 caractères par unité).
    const slug = slugFromTitreRealisation('abcdefghi '.repeat(12))

    expect(slug.length).toBeLessThanOrEqual(LISTE_SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toMatch(LISTE_SLUG_REGEX)
  })

  it('should always produce a slug accepted by the database CHECK (format and length), whatever the title', async () => {
    const { slugFromTitreRealisation } = await regles()
    const titres = [
      '<script>alert(1)</script>',
      "'; DROP TABLE realisations;--",
      '../../etc/passwd',
      'Tab\tet\nsaut',
      '🎉 Atelier 🎉',
      'Ça va ? Oui !',
      'a'.repeat(200),
      'é'.repeat(5000),
    ]

    for (const titre of titres) {
      const slug = slugFromTitreRealisation(titre)
      expect(slug).toMatch(LISTE_SLUG_REGEX)
      expect(slug.length).toBeLessThanOrEqual(LISTE_SLUG_MAX)
    }
  })
})

describe('slug d’une réalisation + unicité par vitrine (U23, S4-CA10)', () => {
  it('should number the same title -2, -3 once the slugs are taken (masked realisations included in the taken set)', async () => {
    const { slugFromTitreRealisation } = await regles()
    const { pickAvailableSlug } = await communes()
    const existants = new Set<string>()
    const titre = 'Dépistage cœur & poumons'

    const slugs = [1, 2, 3].map(() => {
      const slug = pickAvailableSlug(slugFromTitreRealisation(titre), existants, LISTE_SLUG_MAX)
      existants.add(slug)
      return slug
    })

    expect(slugs).toEqual(['depistage-coeur-et-poumons', 'depistage-coeur-et-poumons-2', 'depistage-coeur-et-poumons-3'])
  })

  it('should number the fallback too: "!!!" then "???" give realisation then realisation-2', async () => {
    const { slugFromTitreRealisation } = await regles()
    const { pickAvailableSlug } = await communes()
    const existants = new Set<string>()

    const premier = pickAvailableSlug(slugFromTitreRealisation('!!!'), existants, LISTE_SLUG_MAX)
    existants.add(premier)
    const second = pickAvailableSlug(slugFromTitreRealisation('???'), existants, LISTE_SLUG_MAX)

    expect([premier, second]).toEqual(['realisation', 'realisation-2'])
  })
})
