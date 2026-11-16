import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { URL_ADMIN, cookiesDepuis, creerCompte, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'
import { BASE_URL, db } from './helpers/session'

// A5 (CA01, CA16, CA17), parcours en NAVIGATEUR des catalogues. ÉCRIT, NON EXÉCUTÉ dans ce sprint (exige `pnpm dev`, la base et
// Redis de `.env`). Les libellés sont ceux des composants livrés (CatalogueTableau : « Modifier <pays> », « Utilisé »,
// « Bloquer un nom », « Débloquer <nom> »). Le pays TD est rendu à son état d'origine en fin de fichier. CI : non vérifié.

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
  await fermerAdmin()
})

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
})

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
    await page.goto(`${URL_ADMIN}/admin/catalogues`)
    await attendreHydration(page)

    await page.getByRole('button', { name: /^Modifier Tchad/ }).click()
    const panneau = page.getByRole('dialog')
    await expect(panneau).toBeVisible()
    await expect(panneau.getByRole('button', { name: /Supprimer/ })).toHaveCount(0)
    await expect(panneau.getByRole('checkbox')).toHaveCount(0)
    await panneau.getByRole('switch', { name: /actif/i }).first().click()
    await panneau.getByLabel('Motif').fill(MOTIF)
    await panneau.getByRole('button', { name: /Enregistrer/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

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
    await panneau.getByLabel(/Nom/).first().fill('marque-e2e')
    await panneau.getByLabel('Motif').fill('Nom de marque protégé')
    await panneau.getByRole('button', { name: /Bloquer/ }).last().click()
    await expect(page.getByText('marque-e2e')).toBeVisible()

    await page.getByRole('button', { name: 'Débloquer marque-e2e' }).click()
    await page.getByRole('dialog').getByLabel('Motif').fill(MOTIF)
    await page.getByRole('dialog').getByRole('button', { name: /Débloquer/ }).last().click()
    await expect(page.getByText('marque-e2e')).toHaveCount(0)
  })
})

test.describe('accès (CA17)', () => {
  test('répond 404 à un visiteur sans session d\'administration', async ({ browser }) => {
    const contexte = await browser.newContext()
    const page = await contexte.newPage()

    const reponse = await page.goto(`${URL_ADMIN}/admin/catalogues`)

    expect(reponse?.status()).toBe(404)
    await contexte.close()
  })
})
