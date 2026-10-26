import { describe, expect, it } from 'vitest'
import { SERVICE_SLUG_MAX, SERVICE_SLUG_REGEX } from '../../shared/services'

// U14 — génération des slugs de service (S3-CA09, décisions #27 et #43).
// Imports paresseux : module absent en phase RED = échec propre de chaque test.
//
// CONTRAT ATTENDU : slugFromTitle(titre: string): string
//                   pickAvailableSlug(base: string, existants: ReadonlySet<string>): string
const regles = () => import('../../server/services/services-regles')

describe('slugFromTitle (U14)', () => {
  it.each([
    ['Consultation de cardiologie', 'consultation-de-cardiologie'],
    ['Échographie cœur & poumons', 'echographie-coeur-et-poumons'],
    ['Café & Thé', 'cafe-et-the'],
    ['Œuvre', 'oeuvre'],
    ['ÉCHOGRAPHIE', 'echographie'],
    ['Suivi après infarctus', 'suivi-apres-infarctus'],
    ['Bilan   complet  ', 'bilan-complet'],
    ['Rendez-vous -- spécial', 'rendez-vous-special'],
    ['100% santé', '100-sante'],
    ['a_b', 'a-b'],
  ])('should turn %j into %j', async (titre, attendu) => {
    const { slugFromTitle } = await regles()

    expect(slugFromTitle(titre)).toBe(attendu)
  })

  it('should not split camel case (decamelize disabled)', async () => {
    const { slugFromTitle } = await regles()

    expect(slugFromTitle('MonService')).toBe('monservice')
  })

  it.each([[''], ['   '], ['!!!'], ['???'], ['—'], ['你好'], ['​']])('should fall back to "service" for the title %j', async (titre) => {
    const { slugFromTitle } = await regles()

    expect(slugFromTitle(titre)).toBe('service')
  })

  it('should never exceed 80 characters nor end with a dash when the title is long', async () => {
    const { slugFromTitle } = await regles()
    // 12 mots de 9 lettres : la coupe à 80 tombe sur un tiret (10 caractères par unité).
    const titre = 'abcdefghi '.repeat(12)

    const slug = slugFromTitle(titre)

    expect(slug.length).toBeLessThanOrEqual(SERVICE_SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toMatch(SERVICE_SLUG_REGEX)
    expect(slug.startsWith('abcdefghi-abcdefghi-')).toBe(true)
  })

  it('should accept an 80-character accented title and a very long one without throwing', async () => {
    const { slugFromTitle } = await regles()

    for (const titre of [`${'Électrocardiogramme '.repeat(4).slice(0, 78)} é`, 'é'.repeat(5000)]) {
      const slug = slugFromTitle(titre)

      expect(slug.length).toBeLessThanOrEqual(SERVICE_SLUG_MAX)
      expect(slug).toMatch(SERVICE_SLUG_REGEX)
    }
  })

  it('should always produce a slug accepted by the database CHECK (format and length)', async () => {
    const { slugFromTitle } = await regles()
    const titres = ['<script>alert(1)</script>', "'; DROP TABLE services;--", '../../etc/passwd', 'Tab\tet\nsaut', '🎉 Atelier 🎉', 'Ça va ? Oui !', 'a'.repeat(200)]

    for (const titre of titres) {
      expect(slugFromTitle(titre)).toMatch(SERVICE_SLUG_REGEX)
    }
  })
})

describe('pickAvailableSlug (U14)', () => {
  it('should return the base when it is free', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set())).toBe('bilan')
    expect(pickAvailableSlug('bilan', new Set(['autre']))).toBe('bilan')
  })

  it('should suffix -2 then -3 when the base is taken', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set(['bilan']))).toBe('bilan-2')
    expect(pickAvailableSlug('bilan', new Set(['bilan', 'bilan-2']))).toBe('bilan-3')
    expect(pickAvailableSlug('bilan', new Set(['bilan', 'bilan-2', 'bilan-3']))).toBe('bilan-4')
  })

  it('should reuse the first free number (a gap)', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set(['bilan', 'bilan-3']))).toBe('bilan-2')
  })

  it('should not suffix when only a suffixed variant exists', async () => {
    const { pickAvailableSlug } = await regles()

    expect(pickAvailableSlug('bilan', new Set(['bilan-2']))).toBe('bilan')
  })

  it('should not mutate the set of existing slugs', async () => {
    const { pickAvailableSlug } = await regles()
    const existants = new Set(['bilan'])

    pickAvailableSlug('bilan', existants)

    expect([...existants]).toEqual(['bilan'])
  })

  it('should keep the result within 80 characters by shortening the base, even when it already has 80', async () => {
    const { pickAvailableSlug } = await regles()
    const base = 'a'.repeat(SERVICE_SLUG_MAX)

    const slug = pickAvailableSlug(base, new Set([base]))

    expect(slug.length).toBeLessThanOrEqual(SERVICE_SLUG_MAX)
    expect(slug).toMatch(SERVICE_SLUG_REGEX)
    expect(slug.endsWith('-2')).toBe(true)
    expect(slug).not.toBe(base)
  })

  it('should never leave a double dash when shortening cuts the base right after a dash', async () => {
    const { pickAvailableSlug } = await regles()
    // La coupe à 78 caractères tombe juste après le tiret du caractère 78.
    const base = `${'a'.repeat(77)}-bb`
    expect(base).toHaveLength(SERVICE_SLUG_MAX)

    const slug = pickAvailableSlug(base, new Set([base]))

    expect(slug).toMatch(SERVICE_SLUG_REGEX)
    expect(slug.length).toBeLessThanOrEqual(SERVICE_SLUG_MAX)
  })

  it('should find a free slug among many taken ones, each result distinct and valid', async () => {
    const { pickAvailableSlug } = await regles()
    const existants = new Set<string>()

    for (let i = 0; i < 25; i += 1) {
      const slug = pickAvailableSlug('service', existants)
      expect(existants.has(slug)).toBe(false)
      expect(slug).toMatch(SERVICE_SLUG_REGEX)
      existants.add(slug)
    }
    expect(existants.size).toBe(25)
    expect(existants.has('service')).toBe(true)
    expect(existants.has('service-25')).toBe(true)
  })
})
