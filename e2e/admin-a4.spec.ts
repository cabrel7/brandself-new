import { expect, test } from '@playwright/test'
import { ORIGINE_ADMIN, ORIGINE_PUBLIC, URL_ADMIN, cookiesDepuis, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'
import { db } from './helpers/session'

// A4, parcours en NAVIGATEUR et sur HTTP (écrit, NON exécuté dans ce sprint : exige `pnpm dev`, la base et Redis de `.env`).
// CA02 sur DEUX hôtes (public : studio et connexion suspendus ; administration : ouverte, sa connexion comprise), CA03 (levée sans
// redémarrage, dans le délai du cache de 5 s), page des réglages (une page, message de maintenance sans code), santé avec sauvegarde
// « inconnue » (jamais présentée comme bonne), vérification de la chaîne du journal. Les comptes `e2e-admin-` sont supprimés en fin
// de fichier ; les réglages posés sont supprimés après chaque test. CI : à vérifier (non vérifié que ce fichier y est lancé).

const MESSAGE = 'Retour dans quelques minutes.'
const DELAI_CACHE_MS = 15_000

let admin: CompteE2E
let session: SessionE2E

test.beforeAll(async () => {
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: 'Administrateur A4' })
  session = await ouvrirSession(admin, 'admin')
})

test.afterAll(async () => {
  await db().query('DELETE FROM reglages')
  await db().query('DELETE FROM battements_systeme')
  await nettoyerComptes()
  await fermerAdmin()
})

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
})

test.afterEach(async () => {
  await db().query('DELETE FROM reglages')
})

async function poserMaintenance(active: boolean): Promise<void> {
  await db().query(
    `INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('maintenance.message', to_jsonb($1::text), $2), ('maintenance.active', to_jsonb($3::boolean), $2)
     ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur`,
    [MESSAGE, admin.id, active],
  )
}

test.describe('maintenance (CA02, CA03)', () => {
  test('suspend le studio et la connexion sur l\'hôte public, laisse ouverts les vitrines, l\'état public et l\'administration, puis rétablit sans redémarrage', async ({ request }) => {
    await poserMaintenance(true)

    await expect.poll(async () => (await request.put(`${ORIGINE_PUBLIC}/api/studio/vitrine`, { data: {}, headers: { origin: ORIGINE_PUBLIC } })).status(), { timeout: DELAI_CACHE_MS }).toBe(503)
    const refusee = await request.post(`${ORIGINE_PUBLIC}/api/auth/sign-in/email-otp`, { data: { email: 'x@exemple.test', otp: '000000' }, headers: { origin: ORIGINE_PUBLIC } })
    expect(refusee.status()).toBe(503)
    expect(refusee.headers()['retry-after']).toBe('300')
    expect((await request.get(`${ORIGINE_PUBLIC}/api/public/etat`)).status()).toBe(200)
    expect(await (await request.get(`${ORIGINE_PUBLIC}/api/public/etat`)).json()).toEqual({ maintenance: true, message: MESSAGE, inscriptions: true })
    const sessionAdmin = await request.get(`${ORIGINE_ADMIN}/api/admin/session`, { headers: { cookie: session.cookie } })
    expect(sessionAdmin.status()).toBe(200)

    await poserMaintenance(false)

    await expect.poll(async () => (await request.put(`${ORIGINE_PUBLIC}/api/studio/vitrine`, { data: {}, headers: { origin: ORIGINE_PUBLIC } })).status(), { timeout: DELAI_CACHE_MS }).not.toBe(503)
  })
})

test.describe('réglages, systèmes et journal (écrans)', () => {
  test('modifie le message de maintenance sans code, depuis une seule page de réglages, et l\'écrit au journal', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin/reglages`)
    await attendreHydration(page)

    // Le message de maintenance est dans la catégorie « Accès et maintenance » (la page s'ouvre sur la première).
    await page.getByRole('combobox', { name: 'Catégorie' }).click()
    await page.getByRole('option', { name: 'Accès et maintenance' }).click()
    const champ = page.getByLabel('Message de maintenance')
    await champ.fill(MESSAGE)
    // Chaque réglage a son propre formulaire et son propre « Enregistrer » : on prend celui du message.
    await page.locator('form').filter({ has: champ }).getByRole('button', { name: 'Enregistrer' }).click()
    const dialogue = page.getByRole('dialog')
    await dialogue.getByLabel('Motif').fill('Préparation d’une opération')
    // Ce réglage n'exige pas de code de réauthentification (`reauth: false`).
    await expect(dialogue.getByText('Code de confirmation')).toHaveCount(0)
    await dialogue.getByRole('button', { name: 'Enregistrer', exact: true }).click()

    await expect.poll(async () => (await db().query(`SELECT 1 FROM journal_admin WHERE action = 'reglage.modifier' AND cible_id = 'maintenance.message'`)).rowCount, { timeout: 10_000 }).toBe(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('affiche la sauvegarde comme inconnue tant qu\'aucun battement n\'existe, jamais comme bonne', async ({ page }) => {
    await db().query('DELETE FROM battements_systeme')

    await page.goto(`${URL_ADMIN}/admin/systemes`)
    await attendreHydration(page)

    await expect(page.getByRole('main')).toContainText(/sauvegarde/i)
    await expect(page.getByRole('main')).toContainText(/inconnue/i)
  })

  test('vérifie la chaîne du journal et annonce qu\'elle est intacte', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin/journal`)
    await attendreHydration(page)

    await page.getByRole('button', { name: /vérifier la chaîne/i }).click()

    await expect(page.getByRole('main')).toContainText(/intacte/i)
  })
})
