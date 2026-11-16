import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'
import { URL_ADMIN, cookiesDepuis, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'

// Captures visuelles de l'administration A5 (catalogues et versions), session superadmin RÉELLE, pleine page à 390 px
// (mobile) et 1280 px (PC). Aucune assertion de style : images et rapport JSON (débordement horizontal, zones tactiles
// < 44 px, erreurs de console et de réseau) relus par un humain. Aucune écriture : seuls des panneaux sont ouverts.
// Dossier de sortie : E2E_CAPTURES_DIR, sinon `test-results/captures-admin-a5`.

const DOSSIER = process.env.E2E_CAPTURES_DIR ?? join('test-results', 'captures-admin-a5')
const CIBLE_TACTILE_MIN_PX = 44
const DELAI_STABILISATION_MS = 400
const NOM_ADMIN = 'Administrateur Capture'

const VUES = [
  { nom: 'mobile', taille: { width: 390, height: 844 } },
  { nom: 'pc', taille: { width: 1280, height: 800 } },
] as const

interface Observation {
  page: string
  debordement: boolean
  petitesCibles: string[]
  console: string[]
  reseau: string[]
}

const rapport: Observation[] = []
let session: SessionE2E

test.beforeAll(async () => {
  mkdirSync(DOSSIER, { recursive: true })
  await libererLimitesOtp()
  const admin = await creerSuperadmin({ nom: NOM_ADMIN })
  session = await ouvrirSession(admin, 'admin')
})

test.afterAll(async () => {
  writeFileSync(join(DOSSIER, 'rapport.json'), JSON.stringify(rapport, null, 2))
  await nettoyerComptes()
  await fermerAdmin()
})

function surveiller(page: Page, observation: Observation): void {
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') observation.console.push(`${message.type()}: ${message.text().slice(0, 300)}`)
  })
  page.on('pageerror', (erreur) => observation.console.push(`pageerror: ${erreur.message.slice(0, 300)}`))
  page.on('response', (reponse) => {
    if (reponse.status() >= 400) observation.reseau.push(`${reponse.status()} ${reponse.request().method()} ${new URL(reponse.url()).pathname}`)
  })
}

async function mesurer(page: Page, observation: Observation): Promise<void> {
  const mesures = await page.evaluate((minimum) => {
    const petites: string[] = []
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), [role=tab], [role=switch], select'))) {
      const boite = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (boite.width === 0 || boite.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
      if (boite.height < minimum || boite.width < minimum) {
        const nom = (element.getAttribute('aria-label') ?? element.textContent ?? element.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
        petites.push(`${element.tagName.toLowerCase()} « ${nom} » ${Math.round(boite.width)}x${Math.round(boite.height)}`)
      }
    }
    return { largeurContenu: document.documentElement.scrollWidth, largeurVisible: document.documentElement.clientWidth, petites }
  }, CIBLE_TACTILE_MIN_PX)
  observation.debordement = mesures.largeurContenu > mesures.largeurVisible
  observation.petitesCibles = mesures.petites
}

for (const vue of VUES) {
  test.describe(`captures A5 à ${vue.taille.width} px`, () => {
    test.beforeEach(async ({ context, page }) => {
      await page.setViewportSize(vue.taille)
      await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
    })

    async function capturer(page: Page, nom: string, chemin: string, attente: () => Promise<void>, avant?: () => Promise<void>): Promise<void> {
      const observation: Observation = { page: `${vue.nom}-${nom}`, debordement: false, petitesCibles: [], console: [], reseau: [] }
      surveiller(page, observation)
      await page.goto(`${URL_ADMIN}${chemin}`)
      await attendreHydration(page)
      await attente()
      if (avant) await avant()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      await page.waitForTimeout(DELAI_STABILISATION_MS)
      await mesurer(page, observation)
      await page.screenshot({ path: join(DOSSIER, `${vue.nom}-${nom}.png`), fullPage: true })
      rapport.push(observation)
    }

    test('catalogues : pays, panneau de modification, devises, noms bloqués', async ({ page }) => {
      await capturer(page, 'catalogues-pays', '/admin/catalogues', async () => {
        await expect(page.getByRole('tab', { name: 'Pays' })).toBeVisible()
        await expect(page.getByText('Cameroun').first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'catalogues-pays-modifier', '/admin/catalogues', async () => {
        await expect(page.getByText('Cameroun').first()).toBeVisible({ timeout: 30_000 })
      }, async () => {
        await page.getByRole('button', { name: 'Modifier Cameroun' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
      await capturer(page, 'catalogues-devises', '/admin/catalogues?onglet=devises', async () => {
        await expect(page.getByText('XAF').first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'catalogues-noms-bloques', '/admin/catalogues?onglet=noms-bloques', async () => {
        await expect(page.getByRole('button', { name: 'Bloquer un nom' })).toBeVisible()
      })
      await capturer(page, 'catalogues-noms-bloques-ajout', '/admin/catalogues?onglet=noms-bloques', async () => {
        await expect(page.getByRole('button', { name: 'Bloquer un nom' })).toBeVisible()
      }, async () => {
        await page.getByRole('button', { name: 'Bloquer un nom' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })

    test('versions : plans, aperçu d’impact, prix, frais, moyens, prompts et éditeur', async ({ page }) => {
      await capturer(page, 'versions-plans', '/admin/versions', async () => {
        await expect(page.getByText('Version 1').first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'versions-plans-nouvelle', '/admin/versions', async () => {
        await expect(page.getByText('Version 1').first()).toBeVisible({ timeout: 30_000 })
      }, async () => {
        await page.getByRole('button', { name: 'Nouvelle version', exact: true }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
      await capturer(page, 'versions-prix', '/admin/versions?type=prix', async () => {
        await expect(page.getByText('Version 1').first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'versions-prix-valider', '/admin/versions?type=prix', async () => {
        await expect(page.getByText('Prix non validés')).toBeVisible({ timeout: 30_000 })
      }, async () => {
        await page.getByRole('button', { name: /^Valider les prix/ }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
      await capturer(page, 'versions-frais', '/admin/versions?type=frais', async () => {
        await expect(page.getByText('Version 1').first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'versions-moyens', '/admin/versions?type=moyens', async () => {
        await expect(page.getByText('Version 1').first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'versions-prompts', '/admin/versions?type=prompts', async () => {
        await expect(page.getByText(/Version \d/).first()).toBeVisible({ timeout: 30_000 })
      })
      await capturer(page, 'versions-prompts-editeur', '/admin/versions?type=prompts', async () => {
        await expect(page.getByText(/Version \d/).first()).toBeVisible({ timeout: 30_000 })
      }, async () => {
        await page.getByRole('button', { name: 'Nouvelle version', exact: true }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })
  })
}
