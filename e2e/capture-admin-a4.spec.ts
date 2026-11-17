import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'
import { URL_ADMIN, cookiesDepuis, creerCompte, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'

// Captures visuelles de l'administration A4 (supervision, réglages, journal, capacité d'un compte) et de la page de
// maintenance. Session superadmin RÉELLE, pleine page à 390 px (mobile) et 1280 px (PC). Aucune assertion de style :
// images et rapport JSON (débordement horizontal, zones tactiles < 44 px, erreurs de console et de réseau) relus par un
// humain. Dossier de sortie : E2E_CAPTURES_DIR, sinon `test-results/captures-admin-a4`.

const DOSSIER = process.env.E2E_CAPTURES_DIR ?? join('test-results', 'captures-admin-a4')
const CIBLE_TACTILE_MIN_PX = 44
const DELAI_STABILISATION_MS = 400

const VUES = [
  { nom: 'mobile', taille: { width: 390, height: 844 } },
  { nom: 'pc', taille: { width: 1280, height: 800 } },
] as const

interface Observation {
  page: string
  debordement: boolean
  largeurContenu: number
  largeurVisible: number
  petitesCibles: string[]
  console: string[]
  reseau: string[]
}

const rapport: Observation[] = []
let admin: CompteE2E
let session: SessionE2E
let pro: CompteE2E

test.beforeAll(async () => {
  mkdirSync(DOSSIER, { recursive: true })
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: 'Administrateur Capture A4' })
  session = await ouvrirSession(admin, 'admin')
  pro = await creerCompte({ nom: 'Awa Capture A4' })
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
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), [role=tab], [role=switch], select, summary'))) {
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
  observation.largeurContenu = mesures.largeurContenu
  observation.largeurVisible = mesures.largeurVisible
  observation.debordement = mesures.largeurContenu > mesures.largeurVisible
  observation.petitesCibles = mesures.petites
}

async function photographier(page: Page, vue: string, nom: string, observation: Observation): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(DELAI_STABILISATION_MS)
  await mesurer(page, observation)
  await page.screenshot({ path: join(DOSSIER, `${vue}-${nom}.png`), fullPage: true })
  rapport.push(observation)
}

for (const vue of VUES) {
  test.describe(`captures de l'administration A4 à ${vue.taille.width} px`, () => {
    test.beforeEach(async ({ context, page }) => {
      await page.setViewportSize(vue.taille)
      await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
    })

    async function capturer(page: Page, nom: string, chemin: string, attente: () => Promise<void>, avant?: () => Promise<void>): Promise<void> {
      const observation: Observation = { page: `${vue.nom}-${nom}`, debordement: false, largeurContenu: 0, largeurVisible: 0, petitesCibles: [], console: [], reseau: [] }
      surveiller(page, observation)
      await page.goto(`${URL_ADMIN}${chemin}`)
      await attendreHydration(page)
      await attente()
      if (avant) await avant()
      await photographier(page, vue.nom, nom, observation)
    }

    test('systèmes : santé, files, envois, agrégats', async ({ page }) => {
      await capturer(page, 'systemes', '/admin/systemes', async () => {
        await expect(page.getByRole('heading', { level: 2, name: 'Santé' })).toBeVisible()
        await expect(page.getByRole('heading', { level: 2, name: 'Files de tâches' })).toBeVisible()
      })
    })

    test('réglages : accès, IA, lecture seule, dialogue de confirmation', async ({ page }) => {
      await capturer(page, 'reglages-acces', '/admin/reglages?categorie=acces', async () => {
        await expect(page.getByRole('switch').first()).toBeVisible()
      })
      await capturer(page, 'reglages-ia', '/admin/reglages?categorie=ia', async () => {
        await expect(page.getByText('Demandes d’IA par utilisateur et par heure')).toBeVisible()
      })
      await capturer(page, 'reglages-confirmation', '/admin/reglages?categorie=agenda', async () => {
        await expect(page.getByText('Préavis de réservation par défaut (heures)')).toBeVisible()
      }, async () => {
        const champ = page.getByRole('spinbutton').first()
        await champ.fill('4')
        // Chaque réglage a son formulaire et son « Enregistrer » (désactivé tant que rien n'a changé) : celui du champ modifié.
        await page.locator('form').filter({ has: champ }).getByRole('button', { name: 'Enregistrer' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })

    test('journal : liste, filtres, vérification, export', async ({ page }) => {
      await capturer(page, 'journal', '/admin/journal', async () => {
        await expect(page.getByRole('button', { name: 'Vérifier la chaîne' })).toBeVisible()
      }, async () => {
        await page.getByRole('button', { name: 'Vérifier la chaîne' }).click()
        await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toBeVisible({ timeout: 15_000 })
      })
      await capturer(page, 'journal-export', '/admin/journal', async () => {
        await expect(page.getByRole('button', { name: 'Exporter en CSV' })).toBeVisible()
      }, async () => {
        await page.getByRole('button', { name: 'Exporter en CSV' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })

    test('fiche utilisateur : capacité des assistants', async ({ page }) => {
      await capturer(page, 'capacite-assistants', `/admin/utilisateurs/${pro.id}`, async () => {
        await expect(page.getByRole('heading', { name: 'Capacité des assistants' })).toBeVisible()
      }, async () => {
        await page.getByRole('button', { name: 'Accorder la capacité' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })
  })
}

// La page de maintenance se rend sans session : elle est publique (l'hôte public sert /maintenance).
test('page de maintenance (hôte public)', async ({ page, baseURL }) => {
  for (const vue of VUES) {
    await page.setViewportSize(vue.taille)
    const observation: Observation = { page: `${vue.nom}-maintenance`, debordement: false, largeurContenu: 0, largeurVisible: 0, petitesCibles: [], console: [], reseau: [] }
    surveiller(page, observation)
    await page.goto(`${baseURL ?? ''}/maintenance`)
    await attendreHydration(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Maintenance en cours' })).toBeVisible()
    await photographier(page, vue.nom, 'maintenance', observation)
  }
})
