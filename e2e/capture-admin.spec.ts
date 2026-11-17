import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'
import { URL_ADMIN, cookiesDepuis, creerCompte, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { donnerPlanPayant, insererPaiementEnAttente } from './helpers/abonnement'
import { attendreHydration } from './helpers/hydratation'
import { db } from './helpers/session'

// Captures visuelles de l'administration (A1 à A3), session superadmin RÉELLE (code OTP lu en base, cookie injecté dans le
// navigateur), pleine page à 390 px (mobile) et 1280 px (PC). Les données de test portent le préfixe `e2e-admin-` et sont
// supprimées en fin de fichier. Aucune assertion de style : le fichier produit des images et un rapport JSON
// (débordement horizontal, zones tactiles < 44 px, erreurs de console et de réseau) relus par un humain.
// Dossier de sortie : E2E_CAPTURES_DIR, sinon `test-results/captures-admin`.

const DOSSIER = process.env.E2E_CAPTURES_DIR ?? join('test-results', 'captures-admin')
const CIBLE_TACTILE_MIN_PX = 44
const DELAI_STABILISATION_MS = 400
const NOM_ADMIN = 'Administrateur Capture'
const NOM_PRO = 'Awa Capture'
const PREFIXE_USERNAME = 'e2e-admin-cap-'

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
let pro: CompteE2E & { vitrineId: string, username: string }
let suspendu: CompteE2E
let paiementEnAttenteId = ''

test.beforeAll(async () => {
  mkdirSync(DOSSIER, { recursive: true })
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: NOM_ADMIN })
  session = await ouvrirSession(admin, 'admin')

  const compte = await creerCompte({ nom: NOM_PRO })
  const username = `${PREFIXE_USERNAME}${randomUUID().slice(0, 8)}`
  const vitrineId = randomUUID()
  await db().query(
    `INSERT INTO vitrines (id, user_id, username, titre, prenom, nom, metier, ville, pays, publiee_le)
     VALUES ($1, $2, $3, 'mme', 'Awa', 'Capture', 'Avocate', 'Douala', 'CM', now())`,
    [vitrineId, compte.id, username],
  )
  pro = { ...compte, vitrineId, username }
  await donnerPlanPayant(compte.id, 20)
  const attente = await insererPaiementEnAttente(compte.id)
  paiementEnAttenteId = attente.id
  const echoue = await insererPaiementEnAttente(compte.id, { periodeMois: 1, montant: 2_500 })
  await db().query("UPDATE paiements SET statut = 'echoue', termine_le = now(), prochaine_verification = NULL WHERE id = $1", [echoue.id])

  suspendu = await creerCompte({ nom: 'Compte Suspendu', suspendu: true })

  // Abonnements à échéance proche et en grâce, pour que les trois onglets ne soient pas vides.
  const grace = await creerCompte({ nom: 'Abonnée en grâce' })
  await db().query(
    `INSERT INTO abonnements (id, user_id, plan, expire_le, premiere_activation_le) VALUES ($1, $2, 'payant', now() - interval '2 days', now() - interval '60 days')`,
    [randomUUID(), grace.id],
  )
})

test.afterAll(async () => {
  writeFileSync(join(DOSSIER, 'rapport.json'), JSON.stringify(rapport, null, 2))
  await db().query("DELETE FROM paiements WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-admin-%')")
  await db().query("DELETE FROM vitrines WHERE username LIKE $1", [`${PREFIXE_USERNAME}%`])
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
  test.describe(`captures de l'administration à ${vue.taille.width} px`, () => {
    test.beforeEach(async ({ context, page }) => {
      await page.setViewportSize(vue.taille)
      await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
    })

    /** Ouvre `chemin`, attend le titre, photographie. */
    async function capturer(page: Page, nom: string, chemin: string, attente: () => Promise<void>, avant?: () => Promise<void>): Promise<void> {
      const observation: Observation = { page: `${vue.nom}-${nom}`, debordement: false, largeurContenu: 0, largeurVisible: 0, petitesCibles: [], console: [], reseau: [] }
      surveiller(page, observation)
      await page.goto(`${URL_ADMIN}${chemin}`)
      await attendreHydration(page)
      await attente()
      if (avant) await avant()
      await photographier(page, vue.nom, nom, observation)
    }

    test('connexion (sans session)', async ({ context, page }) => {
      await context.clearCookies()
      await capturer(page, 'connexion', '/admin/connexion', async () => {
        await expect(page.getByRole('button').first()).toBeVisible()
      })
    })

    test('vue d\'ensemble', async ({ page }) => {
      await capturer(page, 'vue-ensemble', '/admin', async () => {
        await expect(page.getByText(`Bonjour, ${NOM_ADMIN}`)).toBeVisible()
      })
    })

    test('utilisateurs : liste, recherche sans résultat, fiche, fiche suspendue, dialogue de confirmation', async ({ page }) => {
      await capturer(page, 'utilisateurs', '/admin/utilisateurs', async () => {
        await expect(page.getByRole('search', { name: 'Rechercher des utilisateurs' })).toBeVisible()
        await expect(page.getByText(NOM_PRO).first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined)
      })
      await capturer(page, 'utilisateurs-recherche-vide', '/admin/utilisateurs', async () => {
        const champ = page.getByRole('main').getByRole('searchbox', { name: 'Rechercher' })
        await champ.fill('zzzz-aucun-resultat-e2e')
      }, async () => {
        await expect(page.getByText(/aucun/i).first()).toBeVisible({ timeout: 15_000 }).catch(() => undefined)
      })
      await capturer(page, 'utilisateur-fiche', `/admin/utilisateurs/${pro.id}`, async () => {
        await expect(page.getByText(pro.email).first()).toBeVisible()
      })
      await capturer(page, 'utilisateur-fiche-suspendu', `/admin/utilisateurs/${suspendu.id}`, async () => {
        await expect(page.getByText(suspendu.email).first()).toBeVisible()
      })
      await capturer(page, 'reauth-suspendre', `/admin/utilisateurs/${pro.id}`, async () => {
        await expect(page.getByText(pro.email).first()).toBeVisible()
      }, async () => {
        await page.getByRole('button', { name: /^Suspendre/ }).first().click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })

    test('vitrines : liste et fiche', async ({ page }) => {
      await capturer(page, 'vitrines', '/admin/vitrines', async () => {
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      })
      await capturer(page, 'vitrine-fiche', `/admin/vitrines/${pro.vitrineId}`, async () => {
        await expect(page.getByText(pro.username).first()).toBeVisible()
      })
    })

    test('abonnements : trois onglets', async ({ page }) => {
      await capturer(page, 'abonnements-renouvellement', '/admin/abonnements?onglet=renouvellement', async () => {
        await expect(page.getByRole('tab').first()).toBeVisible()
      })
      await capturer(page, 'abonnements-grace', '/admin/abonnements?onglet=grace', async () => {
        await expect(page.getByRole('tab').first()).toBeVisible()
      })
      await capturer(page, 'abonnements-expires', '/admin/abonnements?onglet=expires', async () => {
        await expect(page.getByRole('tab').first()).toBeVisible()
      })
    })

    // La liste défile dans le panneau du tableau de bord : une capture pleine page s'arrête à la hauteur de l'écran.
    // On fait défiler jusqu'aux lignes puis on photographie la fenêtre visible.
    test('paiements : lignes de la liste (défilement)', async ({ page }) => {
      await page.goto(`${URL_ADMIN}/admin/paiements`)
      await attendreHydration(page)
      const detail = page.getByRole('button', { name: /voir le paiement/i }).first()
      await expect(detail).toBeVisible()
      await detail.scrollIntoViewIfNeeded()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(DELAI_STABILISATION_MS)
      await page.screenshot({ path: join(DOSSIER, `${vue.nom}-paiements-lignes.png`) })
    })

    test('paiements : liste et tiroir de détail', async ({ page }) => {
      await capturer(page, 'paiements', '/admin/paiements', async () => {
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      })
      await capturer(page, 'paiements-detail', `/admin/paiements?id=${paiementEnAttenteId}`, async () => {
        await expect(page.getByRole('dialog')).toBeVisible()
      })
    })

    test('journal, systèmes, réglages', async ({ page }) => {
      await capturer(page, 'journal', '/admin/journal', async () => {
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      })
    })

    test('état d\'erreur : fiche utilisateur inconnue', async ({ page }) => {
      await capturer(page, 'utilisateur-inconnu', `/admin/utilisateurs/${randomUUID()}`, async () => {
        await expect(page.getByRole('heading').first()).toBeVisible()
      })
    })
  })
}
