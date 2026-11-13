import { expect, test } from '@playwright/test'
import { LLMS_NOTES, ROBOTS_SITEMAP_CHEMIN, SITE_DESCRIPTION } from '../../shared/seo'
import { SITE_URL } from '../helpers/seo'

const HTTP_OK = 200

test.describe('llms.txt', () => {
  test('est servi en texte, décrit le site et pointe vers /tarifs et le plan du site', async ({ request }) => {
    const reponse = await request.get('/llms.txt')
    expect(reponse.status()).toBe(HTTP_OK)
    expect(reponse.headers()['content-type']).toContain('text/')
    const texte = await reponse.text()

    expect(texte).toMatch(/^# /)
    expect(texte).toContain(SITE_DESCRIPTION)
    expect(texte).toContain(`${SITE_URL}/tarifs`)
    expect(texte).toContain(`${SITE_URL}${ROBOTS_SITEMAP_CHEMIN}`)
    for (const note of LLMS_NOTES) {
      expect(texte).toContain(note)
    }
  })

  test('ne cite aucune route privée', async ({ request }) => {
    const texte = await (await request.get('/llms.txt')).text()
    for (const interdit of ['/studio', '/connexion', '/api/', '/mcp']) {
      expect(texte, interdit).not.toContain(interdit)
    }
  })
})
