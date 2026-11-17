import { expect, test } from '@playwright/test'
import { URL_ADMIN, cookiesDepuis, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'
import { demanderEtSaisirCode, fermerReauth } from './helpers/reauth-admin'
import { db } from './helpers/session'

// A5 (CA03, CA11), parcours en NAVIGATEUR des versions : plan gratuit (aperçu d'impact, activation réauthentifiée, retour arrière)
// et prix (validation). Libellés des composants livrés (VersionsHistorique : « Nouvelle version », « Activer, version N »,
// « Retour arrière, version N », « Valider les prix » ; VersionsConfirmation : « Motif », « Recevoir le code », six cases de code).
// Le code de réauthentification est lu dans la file `messages-auth` (mise en pause le temps de la lecture : helpers/reauth-admin.ts,
// comme e2e/admin-a2.spec.ts). Les versions créées sont retirées en fin de fichier (déclencheurs utilisateur levés le temps du
// nettoyage seulement).

const MOTIF = 'Revue trimestrielle des limites'
let admin: CompteE2E
let session: SessionE2E

async function retirerVersionsDeTest(): Promise<void> {
  const client = db()
  await client.query('ALTER TABLE configuration_versions DISABLE TRIGGER USER')
  try {
    await client.query("DELETE FROM configuration_versions WHERE cree_par <> 'systeme'")
    await client.query("UPDATE configuration_versions SET statut = 'active', validee_le = NULL WHERE cree_par = 'systeme'")
  } finally {
    await client.query('ALTER TABLE configuration_versions ENABLE TRIGGER USER')
  }
}

const numerosActifs = async (categorie: string, cle: string): Promise<number[]> => {
  const lignes = await db().query('SELECT numero FROM configuration_versions WHERE categorie = $1 AND cle = $2 AND statut = $3', [categorie, cle, 'active'])
  return lignes.rows.map((r: { numero: number }) => r.numero)
}

test.beforeAll(async () => {
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: 'Administrateur A5' })
  session = await ouvrirSession(admin, 'admin')
})

test.afterAll(async () => {
  await retirerVersionsDeTest()
  await nettoyerComptes()
  await fermerReauth()
  await fermerAdmin()
})

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
})

test.describe('plans', () => {
  test('affiche l\'aperçu d\'impact avant l\'activation, exige le code, active la version puis la retire par un retour arrière (CA03, CA11)', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin/versions?type=plans`)
    await attendreHydration(page)
    await expect(page.getByText('Version 1').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Nouvelle version', exact: true }).click()
    const edition = page.getByRole('dialog')
    await expect(edition).toBeVisible()
    await edition.getByLabel('Motif').fill(MOTIF)
    await edition.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page.getByText('Version 2').first()).toBeVisible()

    await page.getByRole('button', { name: 'Activer, version 2' }).click()
    const confirmation = page.getByRole('dialog')
    const activer = confirmation.getByRole('button', { name: 'Activer', exact: true })
    await expect(activer, 'désactivé tant que l\'aperçu ou le code manque').toBeDisabled()
    await expect(confirmation.getByText(/Estimation : la période de grâce/)).toBeVisible({ timeout: 30_000 })
    await confirmation.getByLabel('Motif').fill(MOTIF)
    // Si l'aperçu touche des comptes, l'activation exige d'acquitter CET impact (interrupteur) ; sinon il n'existe pas.
    const acquittement = confirmation.getByRole('switch', { name: /pris connaissance de cet impact/ })
    if (await acquittement.count() > 0) await acquittement.click()
    await demanderEtSaisirCode(confirmation)
    await expect(activer, 'activable une fois l\'aperçu chargé, le motif et le code saisis').toBeEnabled()
    await activer.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await numerosActifs('plan', 'gratuit')).toEqual([2])

    // Le retour arrière se demande sur la version ACTIVE (la 2) : il rétablit la précédente (la 1).
    await page.getByRole('button', { name: 'Retour arrière, version 2' }).click()
    const retour = page.getByRole('dialog')
    await retour.getByLabel('Motif').fill(MOTIF)
    const confirmerRetour = retour.getByRole('button', { name: 'Retour arrière', exact: true })
    await expect(confirmerRetour, 'désactivé tant que le code manque').toBeDisabled()
    await demanderEtSaisirCode(retour)
    await confirmerRetour.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await numerosActifs('plan', 'gratuit')).toEqual([1])
  })
})

test.describe('prix', () => {
  test('signale la grille non validée et la valide avec un code, sans changer ses montants', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin/versions?type=prix`)
    await attendreHydration(page)
    await expect(page.getByText('Prix non validés')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /^Valider les prix/ }).click()
    const confirmation = page.getByRole('dialog')
    await confirmation.getByLabel('Motif').fill(MOTIF)
    const valider = confirmation.getByRole('button', { name: 'Valider les prix', exact: true })
    await expect(valider, 'désactivé tant que le code manque').toBeDisabled()
    await demanderEtSaisirCode(confirmation)
    await valider.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const ligne = await db().query("SELECT validee_le FROM configuration_versions WHERE categorie = 'prix' AND statut = 'active'")
    expect(ligne.rows[0].validee_le).not.toBeNull()
    await expect(page.getByText('Prix non validés')).toHaveCount(0)
  })
})
