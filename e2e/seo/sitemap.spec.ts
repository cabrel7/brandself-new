import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { SITE_URL, USERNAME_DEMO, versServeurDeTest } from '../helpers/seo'
import { ROBOTS_SITEMAP_CHEMIN } from '../../shared/seo'

const HTTP_OK = 200
const CHEMINS_EXCLUS = ['/studio', '/connexion', '/onboarding', '/api/', '/mcp', '/agenda', '/contact', '/reserver']

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((correspondance) => correspondance[1] ?? '')
}

async function lire(request: APIRequestContext, url: string, baseURL: string): Promise<string> {
  const reponse = await request.get(versServeurDeTest(url, baseURL))
  expect(reponse.status(), url).toBe(HTTP_OK)
  expect(reponse.headers()['content-type'], url).toContain('xml')
  return reponse.text()
}

test.describe('sitemap', () => {
  test('l’index référence des plans absolus, lisibles', async ({ request, baseURL }) => {
    const index = await lire(request, `${SITE_URL}${ROBOTS_SITEMAP_CHEMIN}`, baseURL ?? '')
    const plans = locs(index)
    expect(plans.length).toBeGreaterThan(0)
    for (const plan of plans) {
      expect(plan.startsWith(`${SITE_URL}/`), plan).toBe(true)
      await lire(request, plan, baseURL ?? '')
    }
  })

  test('toutes les URL sont absolues, publiques, et incluent /tarifs et la vitrine de démonstration', async ({ request, baseURL }) => {
    const index = await lire(request, `${SITE_URL}${ROBOTS_SITEMAP_CHEMIN}`, baseURL ?? '')
    const urls: string[] = []
    for (const plan of locs(index)) {
      urls.push(...locs(await lire(request, plan, baseURL ?? '')))
    }
    // Les `loc` d'un plan fils de l'index ne sont pas des plans : on ne garde que les pages.
    const pages = urls.filter((url) => !url.endsWith('.xml'))

    expect(pages).toContain(`${SITE_URL}/tarifs`)
    expect(pages).toContain(`${SITE_URL}/${USERNAME_DEMO}`)
    for (const url of pages) {
      expect(url.startsWith(`${SITE_URL}`), url).toBe(true)
      expect(url, url).not.toMatch(/[?#]/)
      for (const exclu of CHEMINS_EXCLUS) {
        expect(url.slice(SITE_URL.length), url).not.toContain(exclu)
      }
    }
  })
})
