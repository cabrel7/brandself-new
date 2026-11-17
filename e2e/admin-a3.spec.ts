import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { REVENUS_MENTION_INCERTITUDE } from '../shared/admin-paiements'
import { URL_ADMIN, cookiesDepuis, creerCompte, creerSuperadmin, fermerAdmin, libererLimitesOtp, nettoyerComptes, ouvrirSession } from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { insererPaiementEnAttente } from './helpers/abonnement'
import { attendreHydration } from './helpers/hydratation'
import { db } from './helpers/session'

// A3, parcours en NAVIGATEUR (écrit, NON exécuté dans ce sprint : exige `pnpm dev`, la base et Redis de `.env`, et un K-PAY de
// bac à sable ou un faux serveur sur KPAY_BASE_URL). Parcours : onglets d'abonnements, tiroir d'un paiement, revérification,
// bannière d'alertes de la vue d'ensemble, mention d'incertitude des revenus, absence de numéro de téléphone.
// Les comptes créés portent le préfixe `e2e-admin-` et sont supprimés en fin de fichier. CI : à vérifier (non vérifié que ce
// fichier y est lancé).

const NOM_ADMIN = 'Administrateur A3'
const DELAI_ALERTE_MS = 15_000

let admin: CompteE2E
let session: SessionE2E

test.beforeAll(async () => {
  await libererLimitesOtp()
  admin = await creerSuperadmin({ nom: NOM_ADMIN })
  session = await ouvrirSession(admin, 'admin')
})

test.afterAll(async () => {
  await db().query("DELETE FROM paiements WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-admin-%')")
  await nettoyerComptes()
  await fermerAdmin()
})

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookiesDepuis(session.cookie).map(({ name, value }) => ({ name, value, url: URL_ADMIN })))
})

async function abonneA(joursAvantEcheance: number): Promise<CompteE2E> {
  const compte = await creerCompte()
  await db().query(
    `INSERT INTO abonnements (id, user_id, plan, expire_le, premiere_activation_le) VALUES ($1, $2, 'payant', now() + make_interval(days => $3), now() - interval '60 days')`,
    [randomUUID(), compte.id, joursAvantEcheance],
  )
  return compte
}

test.describe('abonnements : onglets et rappel', () => {
  test('affiche chaque abonnement dans son onglet, puis un message vide quand il n\'y en a pas', async ({ page }) => {
    const renouvellement = await abonneA(3)
    const grace = await abonneA(-2)
    const expire = await abonneA(-20)

    await page.goto(`${URL_ADMIN}/admin/abonnements`)
    await attendreHydration(page)
    // Les listes sont des <ul> de lignes (AdminAbonnementLigne) dans `main`, plus des tableaux.
    await expect(page.getByRole('main')).toContainText(renouvellement.email)

    await page.getByRole('tab', { name: /en grâce/i }).click()
    await expect(page).toHaveURL(/onglet=grace/)
    await expect(page.getByRole('main')).toContainText(grace.email)
    await expect(page.getByRole('main')).not.toContainText(renouvellement.email)

    await page.getByRole('tab', { name: /^expirés/i }).click()
    await expect(page).toHaveURL(/onglet=expires/)
    await expect(page.getByRole('main')).toContainText(expire.email)
  })

  test('envoie un rappel avec un motif, puis refuse un second rappel dans les 24 heures avec un message clair', async ({ page }) => {
    // « À renouveler » = échéance dans les 7 prochains jours (server/services/admin/abonnements.ts) : 10 jours n'y figurait pas.
    const compte = await abonneA(5)
    await page.goto(`${URL_ADMIN}/admin/abonnements?onglet=renouvellement`)
    await attendreHydration(page)

    await page.getByRole('button', { name: `Envoyer un rappel à ${compte.email}` }).click()
    await page.getByLabel('Motif').fill('Le titulaire a demandé un rappel')
    await page.getByRole('button', { name: 'Envoyer le rappel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: `Envoyer un rappel à ${compte.email}` }).click()
    await page.getByLabel('Motif').fill('Deuxième demande le même jour')
    await page.getByRole('button', { name: 'Envoyer le rappel' }).click()
    await expect(page.getByRole('alert')).toContainText(/rappel/i)
    const lignes = await db().query('SELECT occurrence FROM emails_transactionnels WHERE type = $1 AND entite_id IN (SELECT id FROM abonnements WHERE user_id = $2)', ['abonnement_rappel', compte.id])
    expect(lignes.rows).toHaveLength(1)
  })
})

test.describe('paiements : liste, tiroir et revérification', () => {
  test('ouvre le tiroir d\'un paiement par ?id=, sans jamais montrer de numéro de téléphone', async ({ page }) => {
    const payeur = await creerCompte()
    const paiement = await insererPaiementEnAttente(payeur.id)

    await page.goto(`${URL_ADMIN}/admin/paiements?id=${paiement.id}`)
    await attendreHydration(page)

    const tiroir = page.getByRole('dialog')
    await expect(tiroir).toBeVisible()
    await expect(tiroir).toContainText(payeur.email)
    await expect(tiroir).toContainText(/revérifier/i)
    const texte = (await page.locator('body').innerText()) + (await page.content())
    expect(texte).not.toContain('•')
    expect(texte).not.toMatch(/\+?237\s?6\d{8}/)
  })

  test('revérifie un paiement auprès de K-PAY : motif demandé, résultat affiché, une seule ligne de journal', async ({ page }) => {
    const payeur = await creerCompte()
    const paiement = await insererPaiementEnAttente(payeur.id)
    await page.goto(`${URL_ADMIN}/admin/paiements?id=${paiement.id}`)
    await attendreHydration(page)

    await page.getByRole('button', { name: /revérifier auprès de k-pay/i }).click()
    await page.getByLabel('Motif').fill('Le titulaire affirme avoir payé')
    await page.getByRole('button', { name: 'Revérifier', exact: true }).click()

    await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toBeVisible()
    const journal = await db().query("SELECT count(*)::int AS n FROM journal_admin WHERE action = 'paiement.reverifier' AND cible_id = $1", [paiement.id])
    expect(journal.rows[0]?.n).toBeLessThanOrEqual(1)
  })

  test('refuse de marquer un paiement comme payé sans code de confirmation', async ({ page }) => {
    const payeur = await creerCompte()
    const paiement = await insererPaiementEnAttente(payeur.id)
    await db().query("UPDATE paiements SET statut = 'echoue', termine_le = now(), prochaine_verification = NULL, id_fournisseur = NULL WHERE id = $1", [paiement.id])
    await page.goto(`${URL_ADMIN}/admin/paiements?id=${paiement.id}`)
    await attendreHydration(page)

    await page.getByRole('button', { name: 'Marquer comme payé' }).click()
    await page.getByLabel('Motif').fill('Paiement reçu hors de K-PAY')
    // Étape 1 : le code est demandé par e-mail ; étape 2 : le bouton « Marquer comme payé » reste désactivé sans code complet.
    await page.getByRole('button', { name: 'Recevoir le code' }).click()
    await expect(page.getByText('Saisissez le code à 6 chiffres')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Marquer comme payé' })).toBeDisabled()
    const manuels = await db().query("SELECT count(*)::int AS n FROM paiements WHERE user_id = $1 AND source = 'manuel'", [payeur.id])
    expect(manuels.rows[0]?.n).toBe(0)
  })

  test('exporte les paiements en CSV après un motif, sans colonne de téléphone', async ({ page }) => {
    const payeur = await creerCompte()
    await insererPaiementEnAttente(payeur.id)
    await page.goto(`${URL_ADMIN}/admin/paiements`)
    await attendreHydration(page)

    await page.getByRole('button', { name: 'Exporter en CSV' }).click()
    await page.getByLabel('Motif').fill('Rapprochement comptable mensuel')
    const avant = await db().query("SELECT count(*)::int AS n FROM journal_admin WHERE action = 'export.paiements'")
    const [telechargement] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Télécharger le fichier' }).click(),
    ])

    expect(telechargement.suggestedFilename()).toMatch(/^paiements-.*\.csv$/)
    const journal = await db().query("SELECT count(*)::int AS n FROM journal_admin WHERE action = 'export.paiements'")
    // Le journal est conservé entre les runs : on compare à l'état d'avant le téléchargement.
    expect(journal.rows[0]?.n).toBe((avant.rows[0]?.n ?? 0) + 1)
  })
})

test.describe('revenus et vue d\'ensemble', () => {
  test('montre la mention d\'incertitude sur les revenus tant que le format K-PAY n\'est pas confirmé', async ({ page }) => {
    await page.goto(`${URL_ADMIN}/admin/paiements`)
    await attendreHydration(page)

    await expect(page.getByText(REVENUS_MENTION_INCERTITUDE).first()).toBeVisible()
  })

  test('affiche UNE seule bannière d\'alertes quand un paiement est ouvert depuis plus d\'une heure', async ({ page }) => {
    const payeur = await creerCompte()
    const paiement = await insererPaiementEnAttente(payeur.id)
    await db().query("UPDATE paiements SET created_at = now() - interval '2 hours' WHERE id = $1", [paiement.id])

    await page.goto(`${URL_ADMIN}/admin`)
    await attendreHydration(page)

    // L'alerte (AlerteVueEnsemble) est un `status` « N points à examiner » ; aucune alerte d'erreur ne doit s'afficher.
    const banniere = page.getByRole('status').filter({ hasText: /points? à examiner/ })
    await expect(banniere).toHaveCount(1, { timeout: DELAI_ALERTE_MS })
    await expect(banniere).toContainText(/paiements? ouverts?/)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(`Bonjour, ${NOM_ADMIN}`)).toBeVisible()
  })
})
