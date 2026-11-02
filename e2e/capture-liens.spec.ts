import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

const MOBILE = { width: 390, height: 844 }
const PC = { width: 1280, height: 800 }

test.describe('Capture pages de liens studio + public', () => {
  // ── Public : vitrine dr-cabrel (seed) ──
  test('public vitrine mobile (@dr-cabrel)', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/@dr-cabrel', { waitUntil: 'networkidle' })
    await page.screenshot({ path: 'capture-public-vitrine-mobile.png', fullPage: true })
  })

  test('public vitrine desktop (@dr-cabrel)', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto('/@dr-cabrel', { waitUntil: 'networkidle' })
    await page.screenshot({ path: 'capture-public-vitrine-desktop.png', fullPage: true })
  })

  // ── Studio : liens ──
  test.describe.serial('studio liens (avec auth)', () => {
    let session: Session
    let username: string

    test.beforeAll(async ({ playwright }) => {
      session = await seConnecter(playwright)
      username = `liens-ui-${randomUUID().slice(0, 8)}`
      const creation = await session.api.post('/api/studio/vitrine', {
        data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
      })
      expect(creation.status()).toBe(201)
      expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
      expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)

      // 4 liens : 3 actifs, 1 masqué (comme le spec liens.spec.ts)
      await session.api.post('/api/studio/liens', { data: { type: 'vitrine', libelle: 'Prendre rendez-vous', page: 'reserver' } })
      await session.api.post('/api/studio/liens', { data: { type: 'whatsapp', libelle: 'Écrire sur WhatsApp', numero: '+237 699 00 00 01' } })
      await session.api.post('/api/studio/liens', {
        data: { type: 'reseau', libelle: 'Mon parcours sur LinkedIn', plateforme: 'linkedin', url: 'https://www.linkedin.com/in/dr-cabrel-nguesso' },
      })
      await session.api.post('/api/studio/liens', { data: { type: 'libre', libelle: 'Site de l’hôpital', url: 'https://hopital.test', actif: false } })
    })

    test.afterAll(async () => {
      await session?.api.dispose()
      await fermerConnexions()
    })

    async function capturer(browser: Browser, chemin: string, nom: string, taille: { width: number; height: number }) {
      const contexte = await browser.newContext({ baseURL: BASE_URL, storageState: await session.api.storageState(), viewport: taille })
      const page = await contexte.newPage()
      await ouvrirStudio(page, chemin)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.screenshot({ path: `capture-${nom}.png`, fullPage: true })
      await contexte.close()
    }

    test('studio liens mobile', async ({ browser }) => {
      await capturer(browser, '/studio/liens', 'studio-liens-mobile', MOBILE)
    })

    test('studio liens desktop', async ({ browser }) => {
      await capturer(browser, '/studio/liens', 'studio-liens-desktop', PC)
    })

    test('studio nouveau lien mobile', async ({ browser }) => {
      await capturer(browser, '/studio/liens/nouveau', 'studio-nouveau-lien-mobile', MOBILE)
    })

    test('studio nouveau lien desktop', async ({ browser }) => {
      await capturer(browser, '/studio/liens/nouveau', 'studio-nouveau-lien-desktop', PC)
    })
  })
})
