import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SEO_VALIDE, descriptionDeLongueur, titreDeLongueur } from './support/seo-ia'

// Décision #24 : contrats Zod du SEO IA (shared/schemas/ia.ts). Même source de vérité que les CHECK de la
// migration 0027 (titre 10..50, description 50..160) : si l'un bouge sans l'autre, la base refuse l'écriture.
const schemas = () => import('../../shared/schemas/ia')

describe('schemaSeoIa', () => {
  it('should accept a proposal in the bounds and return it unchanged', async () => {
    const { schemaSeoIa } = await schemas()

    expect(schemaSeoIa.parse(SEO_VALIDE)).toEqual(SEO_VALIDE)
  })

  it.each([
    [9, false],
    [10, true],
    [50, true],
    [51, false],
  ])('should judge a titre of %i characters: accepted = %s', async (longueur, accepte) => {
    const { schemaSeoIa } = await schemas()
    const titre = longueur < 20 ? 'x'.repeat(longueur) : titreDeLongueur(longueur)

    expect(schemaSeoIa.safeParse({ ...SEO_VALIDE, titre }).success).toBe(accepte)
  })

  it.each([
    [49, false],
    [50, true],
    [160, true],
    [161, false],
  ])('should judge a description of %i characters: accepted = %s', async (longueur, accepte) => {
    const { schemaSeoIa } = await schemas()

    expect(schemaSeoIa.safeParse({ ...SEO_VALIDE, description: descriptionDeLongueur(longueur) }).success).toBe(accepte)
  })

  it('should reject an unknown key (strict)', async () => {
    const { schemaSeoIa } = await schemas()

    expect(schemaSeoIa.safeParse({ ...SEO_VALIDE, extra: 'x' }).success).toBe(false)
  })

  it.each([
    ['titre', { description: SEO_VALIDE.description }],
    ['description', { titre: SEO_VALIDE.titre }],
  ])('should require the %s', async (_nom, partiel) => {
    const { schemaSeoIa } = await schemas()

    expect(schemaSeoIa.safeParse(partiel).success).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'Cardiologue à Douala'],
    ['an array', []],
    ['numbers', { titre: 1, description: 2 }],
    ['null fields', { titre: null, description: null }],
  ])('should reject %s', async (_nom, valeur) => {
    const { schemaSeoIa } = await schemas()

    expect(schemaSeoIa.safeParse(valeur).success).toBe(false)
  })

  it('should not accept a titre or a description made only of spaces (trimmed before the length check)', async () => {
    const { schemaSeoIa } = await schemas()

    expect(schemaSeoIa.safeParse({ titre: ' '.repeat(12), description: SEO_VALIDE.description }).success).toBe(false)
    expect(schemaSeoIa.safeParse({ titre: SEO_VALIDE.titre, description: ' '.repeat(60) }).success).toBe(false)
  })

  it('should keep the stored value free of surrounding whitespace (trimmed)', async () => {
    const { schemaSeoIa } = await schemas()

    const resultat = schemaSeoIa.parse({ titre: `  ${SEO_VALIDE.titre}  `, description: `\n${SEO_VALIDE.description} ` })

    expect(resultat).toEqual(SEO_VALIDE)
  })
})

describe('schemaSeoJobData', () => {
  it('should accept a vitrine identifier and nothing else (nothing personal travels through Redis)', async () => {
    const { schemaSeoJobData } = await schemas()
    const vitrineId = randomUUID()

    expect(schemaSeoJobData.parse({ vitrineId })).toEqual({ vitrineId })
  })

  it.each([
    ['a missing vitrineId', {}],
    ['a non-uuid vitrineId', { vitrineId: 'pas-un-uuid' }],
    ['an empty vitrineId', { vitrineId: '' }],
    ['a numeric vitrineId', { vitrineId: 42 }],
    ['an extra personal field', { vitrineId: randomUUID(), metier: 'Cardiologue' }],
    ['null', null],
  ])('should reject %s', async (_nom, donnees) => {
    const { schemaSeoJobData } = await schemas()

    expect(schemaSeoJobData.safeParse(donnees).success).toBe(false)
  })
})
