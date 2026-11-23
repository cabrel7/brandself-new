import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ESSAI_DEFAUT } from '../shared/essai'
import { URL_ADMIN, cookiesDepuis, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration, ouvrirStudio } from './helpers/hydratation'
import { adresseUnique, creerUtilisateurFrais, DESKTOP, fermerIa, MOBILE, nettoyerUtilisateur, preparerProgression } from './helpers/ia'
import type { UtilisateurFrais } from './helpers/ia'
import { db, fermerConnexions, reinitialiserLimites } from './helpers/session'

// E1 (CA-E1-32 à 34) : essai gratuit à la création de la vitrine, parcours en NAVIGATEUR. PRÉREQUIS : `pnpm dev` (serveur ET worker, comme
// e2e/onboarding.spec.ts : la proposition est préparée par l'IA factice). Les textes attendus sont écrits ici comme ORACLE (app/utils/essai.ts,
// décision D10) : « 14 jours du plan payant … Aucun paiement demandé. », jamais « sans engagement ».
// Un compte neuf par test (adresse e-mail unique : l'essai est accordé). La version `essai` désactivée par CA-33 est retirée à chaque fin de test.

const DELAI_ECRAN_MS = 90_000
const MENTION_PUBLIQUE = '14 jours du plan payant offerts à la création de votre vitrine. Aucun paiement demandé.'
const MESSAGE_FIN_INSCRIPTION = '14 jours du plan payant vous sont offerts. Aucun paiement demandé.'
const MOTS_INTERDITS = /sans engagement|résiliable/i
const ATTENTE_CACHE_CONFIGURATION_MS = 20_000
const INTERVALLE_REESSAI_MS = 2_000
const MESSAGE_ADRESSE_LIBRE = 'Cette adresse est disponible'

const utilisateurs: UtilisateurFrais[] = []

async function nouvelUtilisateur(fabrique: { playwright: Parameters<typeof creerUtilisateurFrais>[0], browser: Parameters<typeof creerUtilisateurFrais>[1] }, viewport = MOBILE) {
  const utilisateur = await creerUtilisateurFrais(fabrique.playwright, fabrique.browser, { viewport })
  utilisateurs.push(utilisateur)
  return utilisateur
}

/** Publie la vitrine depuis l'étape 4 (progression préparée par l'API), et renvoie l'adresse choisie. */
async function publier(page: Page): Promise<string> {
  const username = adresseUnique('e1ui')
  await ouvrirStudio(page, '/onboarding')
  await expect(page.getByRole('heading', { level: 1, name: 'Choisissez votre adresse' })).toBeVisible({ timeout: DELAI_ECRAN_MS })
  await page.getByLabel(/^Votre adresse/).fill(username)
  await expect(page.getByText(MESSAGE_ADRESSE_LIBRE)).toBeVisible()
  await reinitialiserLimites('')
  await page.getByRole('button', { name: 'Publier ma vitrine', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'C’est en ligne.' })).toBeVisible({ timeout: DELAI_ECRAN_MS })
  return username
}

/** Remplace la version `essai` active par une version désactivée (déclencheurs utilisateur levés le temps de l'écriture seulement). */
async function desactiverEssai(): Promise<void> {
  const client = db()
  await client.query('ALTER TABLE configuration_versions DISABLE TRIGGER USER')
  try {
    await client.query("UPDATE configuration_versions SET statut = 'remplacee' WHERE categorie = 'essai' AND cle = 'inscription' AND statut = 'active'")
    await client.query(
      `INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
       VALUES ($1, 'essai', 'inscription', 99, $2::jsonb, 'active', now() - interval '1 minute', 'Essai fermé par un test e2e', 'e2e-essai')`,
      [`e2e-essai-${randomUUID().slice(0, 8)}`, JSON.stringify({ ...ESSAI_DEFAUT, actif: false })],
    )
  } finally {
    await client.query('ALTER TABLE configuration_versions ENABLE TRIGGER USER')
  }
}

async function restaurerEssai(): Promise<void> {
  const client = db()
  await client.query('ALTER TABLE configuration_versions DISABLE TRIGGER USER')
  try {
    await client.query("DELETE FROM configuration_versions WHERE cree_par = 'e2e-essai'")
    await client.query("UPDATE configuration_versions SET statut = 'active' WHERE id = 'e1000000-essai-inscription-1'")
  } finally {
    await client.query('ALTER TABLE configuration_versions ENABLE TRIGGER USER')
  }
}

test.afterAll(async () => {
  await restaurerEssai()
  for (const utilisateur of utilisateurs) {
    await nettoyerUtilisateur(utilisateur.session.userId)
    await utilisateur.fermer()
  }
  await fermerIa()
  await fermerConnexions()
})

test.describe('fin d’inscription et carte Abonnement (CA-E1-32)', () => {
  test('should show ONE message about the 14 days on the « C’est en ligne » screen, then « Essai gratuit, se termine le … » on the Abonnement card', async ({ playwright, browser }) => {
    const { page, session } = await nouvelUtilisateur({ playwright, browser })
    await preparerProgression(session, 4, { nom: `Essai${randomUUID().slice(0, 6)}` })

    await publier(page)

    const message = page.getByText(/14 jours du plan payant/)
    await expect(message).toHaveCount(1)
    await expect(message).toHaveText(MESSAGE_FIN_INSCRIPTION)
    // Un seul message à l'écran : aucun bandeau d'alerte en plus du contenu de la page.
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.getByRole('main').innerText()).not.toMatch(MOTS_INTERDITS)

    await ouvrirStudio(page, '/studio/compte')
    const carte = page.locator('#abonnement')
    await expect(carte.getByText(/^Essai gratuit, se termine le \d{1,2}(er)? \S+ \d{4}$/)).toBeVisible({ timeout: DELAI_ECRAN_MS })
    await expect(carte.getByRole('button', { name: 'Continuer maintenant' })).toBeVisible()
    expect(await carte.innerText()).not.toMatch(MOTS_INTERDITS)
  })
})

test.describe('mention publique (CA-E1-33)', () => {
  test.afterEach(async () => {
    await restaurerEssai()
  })

  for (const chemin of ['/tarifs', '/']) {
    test(`should show the mention on ${chemin} while the version is active, and hide it once actif is false`, async ({ page, browser }) => {
      await page.setViewportSize(DESKTOP)
      await page.goto(chemin)
      await attendreHydration(page)
      await expect(page.getByText(MENTION_PUBLIQUE).first()).toBeVisible()
      expect(await page.locator('body').innerText()).not.toMatch(MOTS_INTERDITS)

      await desactiverEssai()

      // L'instantané de configuration a 5 s au plus ; la route publique est mise en cache 5 minutes côté navigateur : un contexte neuf à chaque essai.
      await expect(async () => {
        const contexte = await browser.newContext()
        try {
          const neuve = await contexte.newPage()
          await neuve.goto(chemin)
          await attendreHydration(neuve)
          await expect(neuve.getByText(MENTION_PUBLIQUE)).toHaveCount(0)
        } finally {
          await contexte.close()
        }
      }).toPass({ timeout: ATTENTE_CACHE_CONFIGURATION_MS, intervals: [INTERVALLE_REESSAI_MS] })
    })
  }
})

test.describe('administration (CA-E1-34)', () => {
  let admin: CompteE2E
  let session: SessionE2E

  test.beforeAll(async () => {
    await libererLimitesOtp()
    admin = await creerSuperadmin({ nom: 'Administrateur E1' })
    session = await ouvrirSession(admin, 'admin')
  })

  test.afterAll(async () => {
    await nettoyerComptes()
    await fermerAdmin()
  })

  test('should show the origin « Essai » on the file of an account in trial and the conversions of the last 30 days on the overview', async ({ playwright, browser, context }) => {
    const { session: compte } = await nouvelUtilisateur({ playwright, browser })
    await preparerProgression(compte, 4, { nom: `Admin${randomUUID().slice(0, 6)}` })
    const termine = await compte.api.post('/api/studio/onboarding/terminer', { data: { username: adresseUnique('e1adm'), palette: 'sauge' } })
    expect(termine.status()).toBe(201)
    expect(((await termine.json()) as { essai: { dureeJours: number } | null }).essai?.dureeJours).toBe(14)

    await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
    const page = await context.newPage()
    await page.goto(`${URL_ADMIN}/admin/utilisateurs/${compte.userId}`)
    await attendreHydration(page)
    const origine = page.getByText('Origine', { exact: true }).locator('xpath=following-sibling::dd[1]')
    await expect(origine).toHaveText('Essai', { timeout: DELAI_ECRAN_MS })
    await expect(page.getByText('Fin de l’essai le')).toBeVisible()

    await page.goto(`${URL_ADMIN}/admin`)
    await attendreHydration(page)
    await expect(page.getByRole('heading', { name: 'Essais gratuits, 30 derniers jours' })).toBeVisible({ timeout: DELAI_ECRAN_MS })
    const accordes = page.getByText('Accordés', { exact: true }).locator('xpath=following-sibling::dd[1]')
    const nombre = Number((await accordes.innerText()).replaceAll(/\D/g, ''))
    expect(nombre).toBeGreaterThanOrEqual(1)
    await expect(page.getByText('Taux de conversion', { exact: true })).toBeVisible()
  })
})
