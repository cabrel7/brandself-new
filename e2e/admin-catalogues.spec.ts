import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { URL_ADMIN, appeler, cookiesDepuis, creerCompte, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'
import { demanderEtSaisirCode, fermerReauth } from './helpers/reauth-admin'
import { BASE_URL, db } from './helpers/session'

// A5 (CA01, CA16, CA17), parcours en NAVIGATEUR des catalogues (exige `pnpm dev`, la base et Redis de `.env`). Les libellés sont
// ceux des composants livrés (CatalogueTableau : « Modifier <pays> », « Utilisé », « Bloquer un nom », « Débloquer <nom> »).
// Toute écriture exige un motif ET un code de réauthentification (« Recevoir le code » puis les six cases : helpers/reauth-admin.ts).
// La liste des pays est paginée (25 par page, ordre alphabétique) : on ouvre la page qui contient le pays voulu.
// Le pays TD est rendu à son état d'origine en fin de fichier.

const TAILLE_PAGE = 25
const LIMITE_PAGES = 20
const MOTIF = 'Vérification demandée par l’équipe'
let admin: CompteE2E
let session: SessionE2E

test.beforeAll(async () => {
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: 'Administrateur A5' })
  session = await ouvrirSession(admin, 'admin')
})

test.afterAll(async () => {
  await db().query("UPDATE pays SET actif = true WHERE code = 'TD'")
  await db().query("DELETE FROM vitrines WHERE username LIKE 'e2e-admin-a5-%'")
  await db().query('DELETE FROM usernames_bloques')
  await nettoyerComptes()
  await fermerReauth()
  await fermerAdmin()
})

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
})

/** Numéro de la page de la liste des pays qui contient `code` (lecture de l'API avec la session de test, 25 par page). */
async function pageDuPays(code: string): Promise<number> {
  for (let numero = 1; numero <= LIMITE_PAGES; numero++) {
    const reponse = await appeler({ chemin: `/api/admin/catalogues/pays?page=${numero}&limite=${TAILLE_PAGE}`, cookie: session.cookie })
    expect(reponse.status).toBe(200)
    const { elements } = reponse.json as { elements: Array<{ code: string }> }
    if (elements.some((e) => e.code === code)) return numero
    if (elements.length < TAILLE_PAGE) break
  }
  throw new Error(`Le pays ${code} est absent du catalogue.`)
}

/** Attend la fermeture du panneau ; sinon l'échec montre le message d'erreur du serveur affiché dans le panneau. */
async function attendreFermeture(page: Page): Promise<void> {
  await expect.poll(async () => {
    if (await page.getByRole('dialog').count() === 0) return 'ferme'
    return `ouvert : ${(await page.getByRole('dialog').getByRole('alert').allTextContents()).join(' | ')}`
  }, { timeout: 20_000 }).toBe('ferme')
}

async function vitrineAuTchad(): Promise<string> {
  const compte = await creerCompte()
  const username = `e2e-admin-a5-${randomUUID().slice(0, 8)}`
  await db().query(
    `INSERT INTO vitrines (id, user_id, username, titre, prenom, nom, metier, ville, pays, publiee_le)
     VALUES ($1, $2, $3, 'dr', 'Cabrel', 'E2E', 'Cardiologue', 'Ndjamena', 'TD', now())`,
    [randomUUID(), compte.id, username],
  )
  return username
}

test.describe('pays', () => {
  test('propose « Désactiver » et jamais « Supprimer » pour un pays utilisé, puis le retire des référentiels publics (CA01)', async ({ page, request }) => {
    await vitrineAuTchad()
    const numeroPage = await pageDuPays('TD')
    await page.goto(`${URL_ADMIN}/admin/catalogues${numeroPage > 1 ? `?page=${numeroPage}` : ''}`)
    await attendreHydration(page)

    await page.getByRole('button', { name: 'Modifier Tchad' }).click()
    const panneau = page.getByRole('dialog')
    await expect(panneau).toBeVisible()
    await expect(panneau.getByRole('button', { name: /Supprimer/ })).toHaveCount(0)
    await expect(panneau.getByRole('checkbox')).toHaveCount(0)
    await panneau.getByRole('switch', { name: /actif/i }).first().click()
    await panneau.getByLabel('Motif').fill(MOTIF)
    await demanderEtSaisirCode(panneau)
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await attendreFermeture(page)

    const referentiels = await request.get(`${BASE_URL}/api/public/referentiels`)
    const { pays } = await referentiels.json() as { pays: Array<{ code: string }> }
    expect(pays.map((p) => p.code)).not.toContain('TD')
    expect(pays.map((p) => p.code)).toContain('CM')
    const lignes = await db().query('SELECT count(*)::int AS n FROM journal_admin WHERE action = $1', ['catalogue.modifier'])
    expect(lignes.rows[0].n).toBeGreaterThanOrEqual(1)
  })
})

test.describe('noms bloqués', () => {
  test('bloque un nom avec un motif, le montre dans la liste, puis le débloque (CA16)', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin/catalogues?onglet=noms-bloques`)
    await attendreHydration(page)

    await page.getByRole('button', { name: 'Bloquer un nom' }).click()
    const panneau = page.getByRole('dialog')
    await panneau.getByLabel('Nom à bloquer').fill('marque-e2e')
    await panneau.getByLabel('Motif').fill('Nom de marque protégé')
    await demanderEtSaisirCode(panneau)
    await panneau.getByRole('button', { name: 'Bloquer ce nom' }).click()
    await attendreFermeture(page)
    await expect(page.getByText('marque-e2e')).toBeVisible()

    await page.getByRole('button', { name: 'Débloquer marque-e2e' }).click()
    const retrait = page.getByRole('dialog')
    await retrait.getByLabel('Motif').fill(MOTIF)
    await demanderEtSaisirCode(retrait)
    await retrait.getByRole('button', { name: 'Débloquer ce nom' }).click()
    await expect(page.getByText('marque-e2e')).toHaveCount(0)
  })
})

test.describe('accès (CA17)', () => {
  // L'hôte d'administration sert la coquille de l'application (200) ; la garde de route lit alors la session et renvoie vers la
  // connexion (même comportement que toutes les pages d'administration, voir e2e/admin-surfaces.spec.ts). Le refus uniforme (404)
  // est celui des routes de données : sans session valide, aucune donnée de catalogue ne sort.
  test('sans session d\'administration : les routes de catalogue répondent 404 et la page renvoie vers la connexion sans rien afficher', async ({ browser }) => {
    for (const chemin of ['/api/admin/catalogues/pays', '/api/admin/catalogues/devises', '/api/admin/catalogues/noms-bloques']) {
      expect((await appeler({ chemin })).status, chemin).toBe(404)
      expect((await appeler({ chemin, cookie: 'better-auth.session_token=inventee' })).status, `${chemin} avec un cookie inventé`).toBe(404)
    }
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    await page.goto(`${URL_ADMIN}/admin/catalogues`)
    await attendreHydration(page)

    await expect(page).toHaveURL(/\/admin\/connexion$/)
    await expect(page.getByRole('button', { name: /^Modifier / })).toHaveCount(0)
    await contexte.close()
  })
})
