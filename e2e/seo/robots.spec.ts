import { expect, test } from '@playwright/test'
import { ROBOTS_DISALLOW, ROBOTS_IA_ENTRAINEMENT, ROBOTS_SITEMAP_CHEMIN } from '../../shared/seo'
import { SITE_URL, USERNAME_DEMO } from '../helpers/seo'

const HTTP_OK = 200
const NOINDEX = 'noindex'

/** Routes techniques : directive `X-Robots-Tag` quel que soit le statut de la réponse (authentification, 405…). */
const ROUTES_NOINDEX = [
  '/studio',
  '/studio/services',
  '/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/connexion',
  '/onboarding',
  `/${USERNAME_DEMO}/agenda`,
  `/${USERNAME_DEMO}/contact`,
] as const

test.describe('robots.txt', () => {
  test('liste les routes techniques, le plan du site, et bloque les robots d’entraînement', async ({ request }) => {
    const reponse = await request.get('/robots.txt')
    expect(reponse.status()).toBe(HTTP_OK)
    const lignes = (await reponse.text()).split('\n').map((ligne) => ligne.trim())

    for (const regle of ROBOTS_DISALLOW) {
      expect(lignes, `Disallow: ${regle}`).toContain(`Disallow: ${regle}`)
    }
    expect(lignes).toContain('Allow: /')
    expect(lignes).toContain(`Sitemap: ${SITE_URL}${ROBOTS_SITEMAP_CHEMIN}`)
    for (const robot of ROBOTS_IA_ENTRAINEMENT) {
      expect(lignes, robot).toContain(`User-agent: ${robot}`)
    }
  })

  test('ne bloque jamais une vitrine par simple préfixe (« Disallow: /studio » seul est interdit)', async ({ request }) => {
    const lignes = (await (await request.get('/robots.txt')).text()).split('\n').map((ligne) => ligne.trim())
    for (const nu of ['/studio', '/mcp', '/onboarding', '/connexion', '/desabonnement', '/api', '/.well-known']) {
      expect(lignes, `Disallow: ${nu}`).not.toContain(`Disallow: ${nu}`)
    }
  })
})

test.describe('noindex des routes non publiques', () => {
  for (const chemin of ROUTES_NOINDEX) {
    test(`${chemin} envoie X-Robots-Tag noindex`, async ({ request }) => {
      const reponse = await request.get(chemin, { maxRedirects: 0 })
      expect(reponse.headers()['x-robots-tag'] ?? '', `statut ${reponse.status()}`).toContain(NOINDEX)
    })
  }

  test('la page de connexion porte aussi la meta robots noindex', async ({ page }) => {
    await page.goto('/connexion')
    expect(await page.locator('meta[name="robots"]').first().getAttribute('content')).toContain(NOINDEX)
  })

  test('une vitrine dont le nom ressemble à une route technique n’est pas noindex par préfixe', async ({ request }) => {
    // Inconnue : 404, mais jamais la directive posée sur /studio ou /mcp.
    for (const chemin of ['/studio-dupont', '/mcp-conseil']) {
      const reponse = await request.get(chemin, { maxRedirects: 0 })
      expect(reponse.headers()['x-robots-tag'] ?? '', chemin).not.toContain('nofollow')
    }
  })
})
