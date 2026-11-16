import { expect, test } from '@playwright/test'
import type { Locator, Page, Request } from '@playwright/test'
import { ADMIN_NAV } from '../shared/admin'
import { ORIGINE_PUBLIC, URL_ADMIN, cookiesDepuis, creerCompte, creerSuperadmin, demanderCodeConnexion, fermerAdmin, libererLimitesOtp, lireSessionsDe, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'
import { db, lireDernierCode } from './helpers/session'

// A1 CA22, en NAVIGATEUR (Chromium, `--host-resolver-rules=MAP admin.localhost 127.0.0.1` dans playwright.config.ts) :
// les pages /admin/* répondent noindex et no-store, n'affichent aucun InstallPrompt, n'envoient aucune vue
// (POST /api/public/<vitrine>/vue) et n'enregistrent aucun service worker. Plus : la garde de route, le parcours de
// connexion (message neutre, refus générique) et la déconnexion.
// Les parcours sans navigateur (en-têtes bruts, 404 par hôte) sont dans e2e/admin-acces.spec.ts.

const DELAI_IDLE_VUE_MS = 2_500
const NOM_ADMIN = 'Administrateur de test'
const MESSAGE_NEUTRE = 'Si cette adresse est autorisée, un code vient d’être envoyé.'
const ERREUR_CODE = 'Code invalide ou expiré.'

let admin: CompteE2E
let session: SessionE2E

test.beforeAll(async () => {
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: NOM_ADMIN })
  session = await ouvrirSession(admin, 'admin')
})

test.afterAll(async () => {
  await nettoyerComptes()
  await fermerAdmin()
})

/** Le navigateur présente la session d'administration (cookie du seul hôte d'administration). */
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
})

interface ObservationPage {
  requetes: Request[]
}

function observer(page: Page): ObservationPage {
  const observation: ObservationPage = { requetes: [] }
  page.on('request', (requete) => observation.requetes.push(requete))
  return observation
}

const estVue = (requete: Request): boolean => requete.method() === 'POST' && /\/api\/public\/[^/]+\/vue$/.test(new URL(requete.url()).pathname)

/** Texte attendu au centre de chaque page : la vue d'ensemble salue l'administrateur, les autres sont provisoires. */
function titreAttendu(to: string): string {
  return to === '/admin' ? `Bonjour, ${NOM_ADMIN}` : 'Bientôt disponible'
}

/** Pages livrées (A2, A3) : un repère de la page elle-même. Les autres (systèmes, réglages, journal) restent provisoires. */
const REPERES_PAGES_LIVREES: Readonly<Record<string, (page: Page) => Locator>> = {
  '/admin/utilisateurs': (page) => page.getByRole('search', { name: 'Rechercher des utilisateurs' }),
  '/admin/vitrines': (page) => page.getByRole('search', { name: 'Rechercher des vitrines' }),
  '/admin/abonnements': (page) => page.getByRole('heading', { level: 1, name: 'Abonnements' }),
}

/** Attend le contenu propre à la page (repère des pages livrées, sinon le texte provisoire). */
async function attendreContenu(page: Page, to: string): Promise<void> {
  const repere = REPERES_PAGES_LIVREES[to]
  if (repere) {
    await expect(repere(page)).toBeVisible()
    await expect(page.getByText('Bientôt disponible')).toHaveCount(0)
  } else {
    await expect(page.getByText(titreAttendu(to))).toBeVisible()
  }
}

test.describe('CA22 pages /admin/* : noindex, no-store, aucune surface publique', () => {
  for (const entree of ADMIN_NAV) {
    test(`CA22 ${entree.to} : noindex, no-store, sans InstallPrompt, sans vue, sans service worker`, async ({ page }) => {
      const observation = observer(page)

      const reponse = await page.goto(`${URL_ADMIN}${entree.to}`)
      await attendreHydration(page)
      await attendreContenu(page, entree.to)
      // Les vues partent dans le temps mort du navigateur (délai max. 2 s) et un service worker s'inscrit après le
      // chargement : on laisse passer ce délai avant d'affirmer l'absence.
      await page.waitForTimeout(DELAI_IDLE_VUE_MS)

      expect(reponse?.status()).toBe(200)
      expect(reponse?.headers()['x-robots-tag']).toMatch(/noindex/)
      expect(reponse?.headers()['cache-control']).toMatch(/no-store/)
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
      await expect(page.getByTestId('install-prompt')).toHaveCount(0)
      await expect(page.locator('[data-pwa-install]')).toHaveCount(0)
      expect(observation.requetes.filter(estVue)).toHaveLength(0)
      expect(observation.requetes.filter((r) => new URL(r.url()).pathname === '/sw.js')).toHaveLength(0)
      const inscriptions = await page.evaluate(async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0))
      expect(inscriptions).toBe(0)
    })
  }

  test('CA22 le bandeau « Administration » est présent sur chaque page, sans bouton de fermeture', async ({ page }) => {
    for (const entree of ADMIN_NAV) {
      await page.goto(`${URL_ADMIN}${entree.to}`)
      await attendreHydration(page)
      await expect(page.getByText('Administration', { exact: true }).first(), entree.to).toBeVisible()
    }
    await expect(page.getByRole('button', { name: /fermer/i })).toHaveCount(0)
  })

  test('CA22 la barre latérale mène à chaque page et la barre du haut montre le nom de l\'administrateur et la déconnexion', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin`)
    await attendreHydration(page)
    await expect(page.getByText(NOM_ADMIN).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible()

    for (const entree of ADMIN_NAV.filter((e) => e.to !== '/admin')) {
      await page.getByRole('link', { name: entree.libelle }).first().click()
      await expect(page).toHaveURL(new RegExp(`${entree.to}$`))
      await attendreContenu(page, entree.to)
    }
  })
})

test.describe('garde de route et séparation des hôtes (navigateur)', () => {
  test('sans session, /admin renvoie vers la connexion, qui est noindex', async ({ browser }) => {
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await page.goto(`${URL_ADMIN}/admin`)
    await attendreHydration(page)

    await expect(page).toHaveURL(/\/admin\/connexion$/)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByRole('button', { name: 'Recevoir un code' })).toBeVisible()
    await contexte.close()
  })

  test('sans session, une page provisoire renvoie aussi vers la connexion', async ({ browser }) => {
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await page.goto(`${URL_ADMIN}/admin/journal`)
    await attendreHydration(page)

    await expect(page).toHaveURL(/\/admin\/connexion$/)
    await contexte.close()
  })

  test('la connexion de l\'administration ne propose ni Google ni téléphone', async ({ browser }) => {
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await page.goto(`${URL_ADMIN}/admin/connexion`)
    await attendreHydration(page)

    await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /téléphone/i })).toHaveCount(0)
    await expect(page.getByLabel(/téléphone/i)).toHaveCount(0)
    await contexte.close()
  })

  test('le studio et la page d\'accueil ne répondent pas sur l\'hôte d\'administration (404)', async ({ page }) => {
    for (const chemin of ['/studio', '/dr-cabrel', '/tarifs', '/connexion', '/sw.js', '/manifest.json']) {
      const reponse = await page.goto(`${URL_ADMIN}${chemin}`)
      expect(reponse?.status(), chemin).toBe(404)
    }
  })

  test('sur le site public, /admin et /admin/connexion répondent 404', async ({ page }) => {
    for (const chemin of ['/admin', '/admin/connexion', '/admin/utilisateurs']) {
      const reponse = await page.goto(`${ORIGINE_PUBLIC}${chemin}`)
      expect(reponse?.status(), chemin).toBe(404)
    }
  })
})

test.describe('parcours de connexion de l\'administration (navigateur)', () => {
  /** Saisit le code dans les six cases (champ numérique) : le premier reçoit le focus, la frappe avance seule. */
  async function saisirCode(page: Page, code: string): Promise<void> {
    await page.getByRole('spinbutton').first().click()
    await page.keyboard.type(code)
  }

  async function demanderCodeDansLInterface(page: Page, email: string): Promise<void> {
    await libererLimitesOtp()
    await page.goto(`${URL_ADMIN}/admin/connexion`)
    await attendreHydration(page)
    await page.getByLabel('Adresse email').fill(email)
    await page.getByRole('button', { name: 'Recevoir un code' }).click()
    await expect(page.getByRole('heading', { name: 'Saisissez votre code' })).toBeVisible()
  }

  test('un superadmin se connecte avec le code reçu, arrive sur la vue d\'ensemble, puis se déconnecte', async ({ browser }) => {
    const compte = await creerSuperadmin({ nom: NOM_ADMIN })
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await demanderCodeDansLInterface(page, compte.email)
    await expect(page.getByRole('status')).toContainText(MESSAGE_NEUTRE)
    await saisirCode(page, await lireDernierCode(compte.email))
    await page.getByRole('button', { name: 'Valider' }).click()

    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByText(`Bonjour, ${NOM_ADMIN}`)).toBeVisible()
    const [ligne] = await lireSessionsDe(compte.id)
    expect(ligne?.admin).toBe(true)

    await page.getByRole('button', { name: 'Déconnexion' }).click()
    await expect(page).toHaveURL(/\/admin\/connexion$/)
    expect(await lireSessionsDe(compte.id)).toHaveLength(0)
    await page.goto(`${URL_ADMIN}/admin`)
    await attendreHydration(page)
    await expect(page).toHaveURL(/\/admin\/connexion$/)
    await contexte.close()
  })

  test('un code faux affiche un refus générique et laisse l\'utilisateur sur l\'écran du code', async ({ browser }) => {
    const compte = await creerSuperadmin()
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await demanderCodeDansLInterface(page, compte.email)
    const bon = await lireDernierCode(compte.email)
    await saisirCode(page, bon === '000000' ? '000001' : '000000')
    await page.getByRole('button', { name: 'Valider' }).click()

    await expect(page.getByRole('alert')).toContainText(ERREUR_CODE)
    await expect(page).toHaveURL(/\/admin\/connexion$/)
    expect(await lireSessionsDe(compte.id)).toHaveLength(0)
    await contexte.close()
  })

  test('une adresse inconnue voit le MÊME écran de code (aucune indication sur l\'existence du compte) puis le même refus générique', async ({ browser }) => {
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await demanderCodeDansLInterface(page, `e2e-admin-inconnue-${Date.now()}@exemple.test`)
    await expect(page.getByRole('status')).toContainText(MESSAGE_NEUTRE)
    await saisirCode(page, '123456')
    await page.getByRole('button', { name: 'Valider' }).click()

    await expect(page.getByRole('alert')).toContainText(ERREUR_CODE)
    await contexte.close()
  })

  test('le code valide d\'un compte ordinaire (obtenu sur le site public) donne le même refus générique, sans session', async ({ browser }) => {
    const ordinaire = await creerCompte()
    await libererLimitesOtp()
    await demanderCodeConnexion(ordinaire.email, 'public')
    const code = await lireDernierCode(ordinaire.email)
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await demanderCodeDansLInterface(page, ordinaire.email)
    await saisirCode(page, code)
    await page.getByRole('button', { name: 'Valider' }).click()

    await expect(page.getByRole('alert')).toContainText(ERREUR_CODE)
    await expect(page).not.toHaveURL(/\/admin$/)
    expect(await lireSessionsDe(ordinaire.id)).toHaveLength(0)
    await contexte.close()
  })

  test('une adresse mal formée est refusée avant tout envoi', async ({ browser }) => {
    const contexte = await browser.newContext()
    const page = await contexte.newPage()
    await page.goto(`${URL_ADMIN}/admin/connexion`)
    await attendreHydration(page)

    await page.getByLabel('Adresse email').fill('pas-une-adresse')
    await page.getByRole('button', { name: 'Recevoir un code' }).click()

    await expect(page.getByText('Entrez une adresse email valide.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Saisissez votre code' })).toHaveCount(0)
    await contexte.close()
  })

  test('une session ouverte depuis plus de 8 heures renvoie vers la connexion à la prochaine navigation', async ({ browser }) => {
    const vieux = await ouvrirSession(await creerSuperadmin(), 'admin')
    const contexte = await browser.newContext()
    await contexte.addCookies(cookiesDepuis(vieux.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
    const page = await contexte.newPage()
    await page.goto(`${URL_ADMIN}/admin`)
    await attendreHydration(page)
    await expect(page.getByText(`Bonjour, ${NOM_ADMIN}`)).toBeVisible()

    await db().query("UPDATE sessions SET created_at = now() - interval '8 hours 1 minute', expires_at = now() + interval '1 hour' WHERE id = $1", [vieux.sessionId])
    await page.getByRole('link', { name: 'Journal' }).first().click()

    await expect(page).toHaveURL(/\/admin\/connexion$/)
    await contexte.close()
  })
})
