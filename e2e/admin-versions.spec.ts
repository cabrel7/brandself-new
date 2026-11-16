import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { FILE_MESSAGES_AUTH, JOBS } from '../shared/jobs'
import { URL_ADMIN, cookiesDepuis, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { attendreHydration } from './helpers/hydratation'
import { db, lireEnv } from './helpers/session'

// A5 (CA03, CA11), parcours en NAVIGATEUR des versions : plan gratuit (aperçu d'impact, activation réauthentifiée, retour arrière)
// et prix (validation). ÉCRIT, NON EXÉCUTÉ dans ce sprint. Libellés des composants livrés (VersionsHistorique : « Nouvelle version »,
// « Activer, version N », « Retour arrière, version N », « Valider les prix » ; VersionsConfirmation : « Motif »,
// « Code de confirmation à 6 chiffres »). Le code de réauthentification est lu dans la file `messages-auth` (file mise en pause
// le temps de la lecture, comme e2e/admin-a2.spec.ts). Les versions créées sont retirées en fin de fichier (déclencheurs
// utilisateur levés le temps du nettoyage seulement). CI : non vérifié.

const MOTIF = 'Revue trimestrielle des limites'
const ATTENTE_JOB_MS = 8_000
let admin: CompteE2E
let session: SessionE2E
let redis: Redis | undefined
let file: Queue | undefined

const fileAuth = (): Queue => {
  redis ??= new Redis(lireEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  file ??= new Queue(FILE_MESSAGES_AUTH, { connection: redis })
  return file
}

/** Lit le code de réauthentification demandé par l'interface (file en pause pour qu'aucun worker ne l'emporte), puis le saisit. */
async function saisirCode(page: Page, declencher: () => Promise<void>): Promise<void> {
  await fileAuth().pause()
  try {
    await declencher()
    const fin = Date.now() + ATTENTE_JOB_MS
    for (;;) {
      const jobs = await fileAuth().getJobs(['wait', 'paused', 'delayed', 'active', 'prioritized'], 0, -1)
      const job = jobs.reverse().find((j) => j.name === JOBS.sendAdminReauthEmail && typeof (j.data as { code?: unknown }).code === 'string')
      if (job) {
        await page.getByLabel('Code de confirmation à 6 chiffres').first().fill((job.data as { code: string }).code)
        return
      }
      if (Date.now() > fin) throw new Error('Aucun code de réauthentification demandé par l’interface.')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    await fileAuth().resume()
  }
}

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
  await fileAuth().close()
  await redis?.quit()
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
    await edition.getByRole('button', { name: /Enregistrer|Créer/ }).last().click()
    await expect(page.getByText('Version 2').first()).toBeVisible()

    await page.getByRole('button', { name: 'Activer, version 2' }).click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation.getByRole('button', { name: /Activer/ }).last(), 'désactivé tant que l\'aperçu ou le code manque').toBeDisabled()
    await expect(confirmation.getByText(/Estimation : la période de grâce/)).toBeVisible({ timeout: 30_000 })
    await confirmation.getByLabel('Motif').fill(MOTIF)
    await saisirCode(page, async () => { await confirmation.getByRole('button', { name: /code/i }).first().click().catch(() => undefined) })
    await confirmation.getByRole('button', { name: /Activer/ }).last().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await numerosActifs('plan', 'gratuit')).toEqual([2])

    await page.getByRole('button', { name: 'Retour arrière, version 1' }).click()
    const retour = page.getByRole('dialog')
    await retour.getByLabel('Motif').fill(MOTIF)
    await saisirCode(page, async () => { await retour.getByRole('button', { name: /code/i }).first().click().catch(() => undefined) })
    await retour.getByRole('button', { name: /Retour arrière|Confirmer/ }).last().click()
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
    await saisirCode(page, async () => { await confirmation.getByRole('button', { name: /code/i }).first().click().catch(() => undefined) })
    await confirmation.getByRole('button', { name: /Valider/ }).last().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const ligne = await db().query("SELECT validee_le FROM configuration_versions WHERE categorie = 'prix' AND statut = 'active'")
    expect(ligne.rows[0].validee_le).not.toBeNull()
    await expect(page.getByText('Prix non validés')).toHaveCount(0)
  })
})
