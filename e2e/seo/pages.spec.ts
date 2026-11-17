import { expect, test } from '@playwright/test'
import { SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_MIN, sansBarreFinale, urlCanonique } from '../../shared/seo'
import {
  IMAGE_PARTAGE,
  PAGES_INDEXABLES,
  SITE_URL,
  blocsJsonLd,
  contenuMeta,
  dimensionsJpeg,
  canoniqueDe,
  urlsJsonLd,
  versServeurDeTest,
} from '../helpers/seo'

const HTTP_OK = 200

for (const chemin of PAGES_INDEXABLES) {
  test.describe(`SEO de ${chemin}`, () => {
    test('canonique absolue, locale et description bornée', async ({ page }) => {
      const reponse = await page.goto(chemin)
      expect(reponse?.status()).toBe(HTTP_OK)

      // Absolue, sur l'URL publique configurée ; la barre finale de la racine n'est pas significative.
      const canonique = await canoniqueDe(page)
      expect(canonique).toMatch(/^https?:\/\//)
      expect(sansBarreFinale(canonique ?? '')).toBe(sansBarreFinale(urlCanonique(SITE_URL, chemin)))
      expect(sansBarreFinale(await contenuMeta(page, 'meta[property="og:url"]') ?? '')).toBe(sansBarreFinale(canonique ?? ''))
      expect(await contenuMeta(page, 'meta[property="og:locale"]')).toMatch(/^fr_[A-Z]{2}$/)

      const description = await contenuMeta(page, 'meta[name="description"]')
      expect(description).not.toBeNull()
      expect(description?.length ?? 0).toBeGreaterThanOrEqual(SEO_DESCRIPTION_MIN)
      expect(description?.length ?? 0).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
    })

    test('indexable : ni meta robots noindex ni X-Robots-Tag noindex', async ({ page }) => {
      const reponse = await page.goto(chemin)
      expect(reponse?.headers()['x-robots-tag'] ?? '').not.toContain('noindex')
      const robots = await contenuMeta(page, 'meta[name="robots"]')
      expect(robots ?? '').not.toContain('noindex')
    })

    test('og:image absolue, 1200×630 déclarée et réelle', async ({ page, request, baseURL }) => {
      await page.goto(chemin)
      const image = await contenuMeta(page, 'meta[property="og:image"]')
      expect(image).toMatch(new RegExp(`^${SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`))
      expect(Number(await contenuMeta(page, 'meta[property="og:image:width"]'))).toBe(IMAGE_PARTAGE.largeur)
      expect(Number(await contenuMeta(page, 'meta[property="og:image:height"]'))).toBe(IMAGE_PARTAGE.hauteur)
      expect(await contenuMeta(page, 'meta[name="twitter:image"]')).toBe(image)

      const octets = await request.get(versServeurDeTest(image ?? '', baseURL ?? ''))
      expect(octets.status()).toBe(HTTP_OK)
      expect(octets.headers()['content-type']).toContain('image/jpeg')
      expect(dimensionsJpeg(await octets.body())).toEqual(IMAGE_PARTAGE)
    })

    test('JSON-LD : JSON valide, schema.org, URL absolues', async ({ page }) => {
      await page.goto(chemin)
      const blocs = await blocsJsonLd(page)
      expect(blocs.length).toBeGreaterThan(0)
      for (const bloc of blocs) {
        expect(JSON.stringify(bloc)).toContain('schema.org')
        for (const url of urlsJsonLd(bloc)) {
          expect(url, `URL relative dans le JSON-LD de ${chemin}`).toMatch(/^https?:\/\//)
        }
      }
    })
  })
}
