import { describe, expect, it } from 'vitest'

// U24 — server/resources/seo.ts : `truncateForSeo` et `SEO_DESCRIPTION_MAX`, déplacés de resources/service.ts
// par la factorisation S4 (décision #58). Le comportement doit rester celui que U17 éprouve via la ressource service.
// Imports paresseux : module absent en phase RED = échec propre de chaque test.
//
// CONTRAT ATTENDU :
//   SEO_DESCRIPTION_MAX = 160
//   truncateForSeo(texte: string): string   (texte déjà sur une ligne ; <= 160 caractères, ellipse « … » comprise)
const seo = () => import('../../server/resources/seo')

describe('truncateForSeo (U24)', () => {
  it('should expose the 160-character limit', async () => {
    const { SEO_DESCRIPTION_MAX } = await seo()

    expect(SEO_DESCRIPTION_MAX).toBe(160)
  })

  it('should return a short text as is', async () => {
    const { truncateForSeo } = await seo()

    expect(truncateForSeo('Un texte court.')).toBe('Un texte court.')
    expect(truncateForSeo('')).toBe('')
  })

  it('should keep a text of exactly 160 characters untouched and cut one of 161', async () => {
    const { truncateForSeo } = await seo()
    const exact = `${'a'.repeat(79)} ${'b'.repeat(80)}`
    expect(exact).toHaveLength(160)

    expect(truncateForSeo(exact)).toBe(exact)
    expect(truncateForSeo(`${exact}c`).length).toBeLessThanOrEqual(160)
    expect(truncateForSeo(`${exact}c`)).not.toBe(`${exact}c`)
  })

  it('should cut a long text on a word boundary and end with an ellipsis', async () => {
    const { truncateForSeo } = await seo()
    const texte = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')

    const coupe = truncateForSeo(texte)

    expect(coupe.length).toBeLessThanOrEqual(160)
    expect(coupe.endsWith('…')).toBe(true)
    const sansEllipse = coupe.slice(0, -1)
    expect(texte.startsWith(sansEllipse)).toBe(true)
    expect(texte.charAt(sansEllipse.length)).toMatch(/\s/)
    expect(sansEllipse).toBe(sansEllipse.trimEnd())
  })

  it('should still cut a 400-character text without any space', async () => {
    const { truncateForSeo } = await seo()

    const coupe = truncateForSeo('a'.repeat(400))

    expect(coupe.length).toBeLessThanOrEqual(160)
    expect(coupe.length).toBeGreaterThan(100)
  })
})
