import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { makePng } from '../tests/support/images'
import {
  BOUTON_VOIR_ABONNEMENT, CarteAbonnementPage, donnerPlanGrace, donnerPlanPayant, envoyerWebhookKpay, formaterXaf,
  insererPaiementEnAttente, lireOffre, MESSAGE_BADGE, MONTANT_12_MOIS, retirerPlan, TarifsPage, TELEPHONE_MASQUE_TEST,
} from './helpers/abonnement'
import { ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, db, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

// S10 lot F2 (CA100 à CA107) : interface de l'abonnement, des limites du plan gratuit, de /tarifs et du badge.
// Serveur réel, session Better Auth réelle, PostgreSQL réel. AUCUNE initiation réelle : « Payer » appellerait le bac à sable K-PAY
// (le serveur de test ne pointe pas sur le faux K-PAY, la configuration Playwright n'est pas modifiée). Le paiement est donc posé
// `en_attente` en base, puis l'écran de suivi, l'activation, l'échec et l'anomalie sont joués avec de VRAIS webhooks signés envoyés
// au serveur réel (secret KPAY_WEBHOOK_SECRET de l'environnement). En interface, seule la validation du formulaire est jouée.
// Un seul compte pour tout le fichier (limite d'envoi OTP) : son état d'abonnement est posé en base avant chaque test.

/** Motif tolérant aux espaces insécables / fines des montants formatés. */
function motifSouple(texte: string): RegExp {
  return new RegExp(texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\u00a0\u202f]+/g, '\\s*'))
}

const MOBILE = { width: 390, height: 844 }
const TABLETTE = { width: 768, height: 1024 }
const PC = { width: 1280, height: 800 }
const DELAI_SUIVI_MS = 40_000
const DELAI_TEST_MS = 240_000
const NB_LIMITE = 3
const NB_RESERVATIONS_LIMITE = 10
const MINUTES_CRENEAU = 30
const MS_PAR_JOUR = 86_400_000

async function sansDebordementHorizontal(page: Page): Promise<void> {
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(debordement, 'la page ne doit pas défiler horizontalement').toBeLessThanOrEqual(0)
}

test.describe.serial('abonnement, limites du plan gratuit, tarifs et badge (S10 CA100 à CA107)', () => {
  let session: Session
  let contexte: BrowserContext
  let page: Page
  let carte: CarteAbonnementPage
  let webhooks: APIRequestContext
  let vitrineId: string
  let imageId: string
  const username = `abo-${randomUUID().slice(0, 8)}`
  const serviceIds: string[] = []

  async function creerService(titre: string, extra: Record<string, unknown> = {}): Promise<{ id: string, slug: string }> {
    const reponse = await session.api.post('/api/studio/services', { data: { titre, type: 'rdv', dureeMin: MINUTES_CRENEAU, tarif: 'gratuit', ...extra } })
    expect(reponse.status(), await reponse.text()).toBe(201)
    const { service } = (await reponse.json()) as { service: { id: string, slug: string } }
    serviceIds.push(service.id)
    return service
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status(), await creation.text()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    vitrineId = (await db().query<{ id: string }>('SELECT id FROM vitrines WHERE user_id = $1', [session.userId])).rows[0].id
    const televersement = await session.api.post('/api/studio/medias', {
      multipart: { fichier: { name: 'projet.png', mimeType: 'image/png', buffer: await makePng(400, 300) } },
    })
    expect(televersement.status()).toBe(201)
    imageId = ((await televersement.json()) as { media: { id: string } }).media.id
    webhooks = await playwright.request.newContext({ baseURL: BASE_URL })
    contexte = await browser.newContext({ baseURL: BASE_URL, storageState: await session.api.storageState(), viewport: MOBILE })
    page = await contexte.newPage()
    carte = new CarteAbonnementPage(page)
  })

  test.beforeEach(async () => {
    test.setTimeout(DELAI_TEST_MS)
    await retirerPlan(session.userId)
    await db().query("DELETE FROM paiements WHERE user_id = $1 AND statut IN ('cree','en_attente')", [session.userId])
    await page.setViewportSize(MOBILE)
  })

  test.afterAll(async () => {
    if (vitrineId) await db().query('DELETE FROM reservations WHERE vitrine_id = $1', [vitrineId])
    await contexte?.close()
    await webhooks?.dispose()
    await session?.api.dispose()
    await fermerConnexions()
  })

  // -------------------------------------------------------------------------------------------
  // Carte Abonnement
  // -------------------------------------------------------------------------------------------

  test('CA104 plan gratuit : quotas, prix de l’API, choix de durée en boutons radio au clavier, aucune case à cocher, renouvellement manuel', async () => {
    const offre = await lireOffre(session.api)
    expect(offre.paiementDisponible, 'le paiement doit être configuré sur le serveur de test (clés K-PAY)').toBe(true)
    const prix = offre.devises[0].prix
    const montant = (mois: number): number => prix.find((p) => p.periodeMois === mois)!.montant

    await carte.ouvrir()

    await expect(carte.carte().getByText('Plan gratuit', { exact: true })).toBeVisible()
    await expect(carte.carte().getByText('Vous profitez du plan gratuit.')).toBeVisible()
    await expect(carte.carte().getByText('Services', { exact: true })).toBeVisible()
    await expect(carte.carte().getByText('0 sur 10')).toBeVisible()
    await expect(carte.carte().getByRole('checkbox')).toHaveCount(0)
    await expect(carte.carte().getByRole('switch')).toHaveCount(0)
    await expect(carte.mention()).toBeVisible()
    for (const mois of [1, 3, 12]) await expect(carte.radioPeriode(mois)).toBeVisible()
    await expect(carte.radioPeriode(12)).toBeChecked()
    // Le prix et « le plus avantageux » sont des paragraphes voisins du radio (non reliés à son nom accessible : dette S10) : on teste le texte visible.
    await expect(carte.carte().getByText(new RegExp(`${motifSouple(formaterXaf(montant(12))).source}\\s*·\\s*le plus avantageux`, 'i'))).toBeVisible()
    for (const mois of [1, 3, 12]) await expect(carte.carte().getByText(motifSouple(formaterXaf(montant(mois)))).first()).toBeVisible()
    await expect(carte.payer(`Payer ${formaterXaf(MONTANT_12_MOIS)}`)).toBeVisible()

    // Clavier : focus puis Espace sur chaque durée (les flèches de la bibliothèque sont instables sous Playwright : à vérifier à la main).
    await carte.radioPeriode(3).focus()
    await page.keyboard.press('Space')
    await expect(carte.radioPeriode(3)).toBeChecked()
    await expect(carte.payer(`Payer ${formaterXaf(montant(3))}`)).toBeVisible()
    await carte.radioPeriode(1).focus()
    await page.keyboard.press('Space')
    await expect(carte.radioPeriode(1)).toBeChecked()
    await expect(carte.payer(`Payer ${formaterXaf(montant(1))}`)).toBeVisible()

    await expect(carte.radioMoyen('MTN MoMo')).toBeVisible()
    await expect(carte.radioMoyen('Orange Money')).toBeVisible()
    await carte.radioMoyen('MTN MoMo').focus()
    await page.keyboard.press('Space')
    await expect(carte.radioMoyen('MTN MoMo')).toBeChecked()
    await sansDebordementHorizontal(page)
  })

  test('validation du formulaire : un seul message à la fois, focus sur le premier champ invalide, aucun envoi', async () => {
    const envois: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/studio/abonnement/paiements')) envois.push(r.url())
    })
    await carte.ouvrir()

    // Rien de choisi : le moyen est le premier champ invalide.
    await carte.payer(/^Payer /).click()
    await expect(carte.carte().getByText('Choisissez votre moyen de paiement.')).toBeVisible()
    await expect(carte.radioMoyen('MTN MoMo')).toBeFocused()

    // Moyen choisi, numéro vide : seul le numéro est refusé, le focus va au champ.
    await carte.radioMoyen('MTN MoMo').click()
    await expect(carte.carte().getByText('Choisissez votre moyen de paiement.')).toHaveCount(0)
    await carte.payer(/^Payer /).click()
    await expect(carte.carte().getByText('Saisissez le numéro de votre compte Mobile Money.')).toBeVisible()
    await expect(carte.carte().getByText(/Choisissez votre moyen|Choisissez une durée/)).toHaveCount(0)
    await expect(carte.telephone()).toBeFocused()

    // Numéro trop court : même refus ; il disparaît dès qu'on corrige.
    await carte.telephone().fill('1234')
    await carte.payer(/^Payer /).click()
    await expect(carte.carte().getByText('Saisissez le numéro de votre compte Mobile Money.')).toBeVisible()
    await carte.telephone().fill('653456789')
    await expect(carte.carte().getByText('Saisissez le numéro de votre compte Mobile Money.')).toHaveCount(0)
    expect(envois, 'aucune initiation ne part pour un formulaire invalide').toEqual([])
    page.removeAllListeners('request')
  })

  // -------------------------------------------------------------------------------------------
  // Suivi du paiement (webhooks signés réels)
  // -------------------------------------------------------------------------------------------

  test('CA101 CA103 paiement en attente repris après rechargement, puis webhook signé : « actif jusqu’au » sans recharger, plus de badge', async () => {
    const paiement = await insererPaiementEnAttente(session.userId)

    await carte.ouvrir()
    await expect(carte.titreAttente()).toBeVisible()
    await expect(carte.titreAttente()).toBeFocused()
    await expect(carte.carte().getByText(TELEPHONE_MASQUE_TEST)).toBeVisible()
    await expect(carte.carte().getByText(formaterXaf(MONTANT_12_MOIS))).toBeVisible()
    await expect(carte.payer(/^Payer /)).toHaveCount(0)

    await page.reload()
    await expect(carte.titreAttente()).toBeVisible({ timeout: 90_000 })

    await envoyerWebhookKpay(webhooks, paiement, MONTANT_12_MOIS)

    await expect(carte.titreReussi()).toBeVisible({ timeout: DELAI_SUIVI_MS })
    await expect(carte.titreReussi()).toBeFocused()
    await carte.carte().getByRole('button', { name: 'Terminé' }).click()
    await expect(carte.carte().getByText('Actif jusqu’au')).toBeVisible()
    await expect(carte.carte().getByText('Plan payant', { exact: true })).toBeVisible()
    await expect(carte.payer('Renouveler maintenant')).toBeVisible()

    await page.goto(`/${username}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(MESSAGE_BADGE)).toHaveCount(0)
  })

  test('CA102 échec annoncé par le fournisseur : message du code, « Réessayer » ramène au formulaire', async () => {
    const paiement = await insererPaiementEnAttente(session.userId)
    await carte.ouvrir()
    await expect(carte.titreAttente()).toBeVisible()

    await envoyerWebhookKpay(webhooks, paiement, MONTANT_12_MOIS, { event: 'payment.failed', status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' })

    await expect(carte.titreEchec()).toBeVisible({ timeout: DELAI_SUIVI_MS })
    await expect(carte.titreEchec()).toBeFocused()
    await expect(carte.carte().getByText('Ce numéro n’a pas de compte Mobile Money chez cet opérateur. Vérifiez le numéro et l’opérateur.')).toBeVisible()
    await carte.reessayer().click()
    await expect(carte.payer(/^Payer /)).toBeVisible()
    await expect(carte.telephone()).toBeVisible()
    const etat = await db().query<{ plan: string }>('SELECT plan FROM abonnements WHERE user_id = $1', [session.userId])
    expect(etat.rows, 'un échec n’active aucun abonnement').toHaveLength(0)
  })

  test('anomalie (montant du webhook différent) : aucune activation, pas de « Réessayer », bouton « Actualiser »', async () => {
    const paiement = await insererPaiementEnAttente(session.userId)
    await carte.ouvrir()
    await expect(carte.titreAttente()).toBeVisible()

    await envoyerWebhookKpay(webhooks, paiement, MONTANT_12_MOIS, { montant: 1000 })

    await expect(carte.titreAnomalie()).toBeVisible({ timeout: DELAI_SUIVI_MS })
    await expect(carte.reessayer()).toHaveCount(0)
    await expect(carte.carte().getByRole('button', { name: 'Actualiser' })).toBeVisible()
    await expect(carte.carte().getByRole('button', { name: 'Fermer' })).toHaveCount(0)
    const etat = await db().query('SELECT 1 FROM abonnements WHERE user_id = $1', [session.userId])
    expect(etat.rows).toHaveLength(0)
  })

  test('carte d’un abonnement actif : échéance, jours restants, « Renouveler maintenant », plus de quotas', async () => {
    await donnerPlanPayant(session.userId)

    await carte.ouvrir()

    await expect(carte.carte().getByText('Actif jusqu’au')).toBeVisible()
    await expect(carte.carte().getByText(/^Il vous reste \d+ jours?\.$/)).toBeVisible()
    await expect(carte.carte().getByText('Plan payant', { exact: true })).toBeVisible()
    await expect(carte.carte().getByText('Vous profitez du plan gratuit.')).toHaveCount(0)
    await expect(carte.payer('Renouveler maintenant')).toBeVisible()
    await expect(carte.mention()).toBeVisible()
    await sansDebordementHorizontal(page)
  })

  test('CA106 grâce : la carte le dit, le bandeau unique remplace la prochaine étape du studio', async () => {
    await donnerPlanGrace(session.userId)

    await carte.ouvrir()
    await expect(carte.carte().getByText('Votre abonnement est terminé.')).toBeVisible()
    await expect(carte.carte().getByText('Vous gardez tout jusqu’au')).toBeVisible()
    await expect(carte.payer('Renouveler maintenant')).toBeVisible()

    await ouvrirStudio(page, '/studio')
    await expect(page.getByRole('heading', { level: 2, name: 'Votre abonnement est terminé.' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Votre abonnement est terminé.' })).toHaveCount(1)
    await expect(page.getByText('Prochaine étape', { exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Renouveler mon abonnement' }).click()
    await expect(page).toHaveURL(/\/studio\/compte/)
    await expect(carte.titre()).toBeVisible()

    // Hors grâce, le bandeau n'existe pas : la prochaine étape revient.
    await retirerPlan(session.userId)
    await ouvrirStudio(page, '/studio')
    await expect(page.getByText('Prochaine étape', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Votre abonnement est terminé.' })).toHaveCount(0)
  })

  // -------------------------------------------------------------------------------------------
  // Limites du plan gratuit (4e création)
  // -------------------------------------------------------------------------------------------

  test('CA100 3 services, 3 réalisations, 3 témoignages : « Ajouter » affiche UN seul message de limite avec « Voir l’abonnement »', async () => {
    for (let n = 1; n <= NB_LIMITE; n += 1) {
      await creerService(`Service ${n}`)
      const realisation = await session.api.post('/api/studio/realisations', { data: { titre: `Réalisation ${n}`, imageMediaId: imageId } })
      expect(realisation.status(), await realisation.text()).toBe(201)
      const temoignage = await session.api.post('/api/studio/temoignages', {
        data: { slug: `abo-${username}-${n}`, auteur: `Client ${n}`, texte: 'Un accompagnement très professionnel.', enVedette: false, actif: true },
      })
      expect(temoignage.status(), await temoignage.text()).toBe(200)
    }

    const listes = [
      { chemin: '/studio/services', titre: 'Limite de services atteinte', texte: 'Vous avez atteint 3 services, la limite du plan gratuit.' },
      { chemin: '/studio/realisations', titre: 'Limite de réalisations atteinte', texte: 'Vous avez atteint 3 réalisations, la limite du plan gratuit.' },
      { chemin: '/studio/temoignages', titre: 'Limite de témoignages atteinte', texte: 'Vous avez atteint 3 témoignages, la limite du plan gratuit.' },
    ]
    for (const liste of listes) {
      await ouvrirStudio(page, liste.chemin)
      const ajouter = page.getByRole('button', { name: 'Ajouter', exact: true })
      await expect(ajouter).toBeVisible()
      await ajouter.click()

      const message = page.getByRole('status').filter({ hasText: liste.titre })
      await expect(message).toHaveCount(1)
      await expect(message).toContainText(liste.texte)
      await expect(page.getByText(liste.titre, { exact: true })).toHaveCount(1)
      await expect(page.getByRole('alert'), `aucune autre erreur sur ${liste.chemin}`).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`${liste.chemin}$`))
      const lien = message.getByRole('link', { name: BOUTON_VOIR_ABONNEMENT })
      await expect(lien).toHaveAttribute('href', '/studio/compte#abonnement')
      await lien.click()
      await expect(page).toHaveURL(/\/studio\/compte#abonnement$/)
      await expect(carte.titre()).toBeVisible()
    }
  })

  test('badge « Créé avec Brandself » et masquage public : présents en gratuit, absents en payant et en grâce, les éléments reviennent', async () => {
    await donnerPlanPayant(session.userId)
    await creerService('Service 4')
    await retirerPlan(session.userId)

    await page.setViewportSize(PC)
    await page.goto(`/${username}/services`)
    await expect(page.getByRole('heading', { level: 1, name: 'Mes services' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(NB_LIMITE)
    await expect(page.getByRole('heading', { level: 3, name: 'Service 4' })).toHaveCount(0)
    await page.goto(`/${username}`)
    await expect(page.getByText(MESSAGE_BADGE)).toBeVisible()

    await donnerPlanPayant(session.userId)
    await page.goto(`/${username}/services`)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(NB_LIMITE + 1)
    await page.goto(`/${username}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(MESSAGE_BADGE)).toHaveCount(0)

    await donnerPlanGrace(session.userId)
    await page.goto(`/${username}/services`)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(NB_LIMITE + 1)
    await page.goto(`/${username}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(MESSAGE_BADGE)).toHaveCount(0)

    await retirerPlan(session.userId)
    await page.goto(`/${username}/services`)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(NB_LIMITE)
    await page.goto(`/${username}`)
    await expect(page.getByText(MESSAGE_BADGE)).toBeVisible()
  })

  test('CA107 visiteur : quota de réservations du mois atteint, le bloc agenda explique et propose le contact, sans créneau ni mention de plan', async () => {
    // Les tests précédents ont rempli les 3 places du plan gratuit : on repart d'une vitrine sans services.
    await db().query('DELETE FROM services WHERE vitrine_id = $1', [vitrineId])
    const service = await creerService('Consultation à réserver', { reservable: true })
    expect((await session.api.put('/api/studio/agenda/disponibilites', { data: { items: [{ jourSemaine: 1, debut: '09:00', fin: '10:00' }] } })).status()).toBe(200)
    await donnerPlanPayant(session.userId)
    await retirerPlan(session.userId)
    for (let n = 1; n <= NB_RESERVATIONS_LIMITE; n += 1) {
      const debut = new Date(Date.now() + (n + 7) * MS_PAR_JOUR)
      const fin = new Date(debut.getTime() + MINUTES_CRENEAU * 60_000)
      await db().query(
        `INSERT INTO reservations (id, vitrine_id, service_id, nom, email, telephone, debut, fin, statut, confirmation_token_hash, confirmation_expire_le)
         VALUES ($1,$2,$3,'Visiteur quota',$4,'+237600000000',$5,$6,'en_attente',$7, now() + interval '30 days')`,
        [randomUUID(), vitrineId, service.id, `quota-${n}-${randomUUID()}@example.com`, debut, fin, randomBytes(32).toString('hex')],
      )
    }

    const visiteur = await contexte.browser()!.newContext({ baseURL: BASE_URL, viewport: PC })
    try {
      const p = await visiteur.newPage()
      const du = new Date().toISOString().slice(0, 10)
      const au = new Date(Date.now() + 28 * MS_PAR_JOUR).toISOString().slice(0, 10)
      const api = await p.request.get(`/api/public/${username}/creneaux`, { params: { service: service.slug, du, au } })
      expect(api.status(), await api.text()).toBe(200)
      expect(await api.json()).toMatchObject({ creneaux: [], suspendues: true })

      await p.goto(`/${username}/agenda?service=${service.slug}`)
      const message = p.getByText('Ce professionnel ne prend plus de nouvelle réservation en ligne ce mois-ci. Vous pouvez le contacter directement.')
      await expect(message).toBeVisible({ timeout: 60_000 })
      await expect(p.getByRole('link', { name: 'Contacter directement' })).toHaveAttribute('href', `/${username}/contact`)
      await expect(p.getByText(/abonnement|plan gratuit|plan payant/i)).toHaveCount(0)
    } finally {
      await visiteur.close()
    }
  })

  // -------------------------------------------------------------------------------------------
  // /tarifs
  // -------------------------------------------------------------------------------------------

  test('CA105 /tarifs : 2 plans, prix XAF de l’API, renouvellement manuel dit honnêtement, sans sélecteur de devise, sans débordement à 390, 768 et 1280', async ({ browser }) => {
    const offre = await lireOffre(session.api)
    expect(offre.devises.map((d) => d.devise)).toEqual(['XAF'])
    const montant12 = offre.devises[0].prix.find((p) => p.periodeMois === 12)!.montant
    const visiteur = await browser.newContext({ baseURL: BASE_URL, viewport: MOBILE })
    try {
      const p = await visiteur.newPage()
      const tarifs = new TarifsPage(p)
      for (const viewport of [MOBILE, TABLETTE, PC]) {
        await p.setViewportSize(viewport)
        await tarifs.ouvrir()
        await expect(tarifs.planGratuit()).toBeVisible()
        await expect(tarifs.planPayant()).toBeVisible()
        await expect(p.getByRole('heading', { level: 2 })).toHaveCount(2)
        await expect(tarifs.planPayant()).toContainText(`facturé ${formaterXaf(montant12)} pour 12 mois`)
        await expect(p.getByRole('radiogroup', { name: 'Devise' })).toHaveCount(0)
        await expect(p.getByText(/Pas de renouvellement automatique/)).toBeVisible()
        await expect(p.getByText(/7 jours de grâce/)).toBeVisible()
        await expect(tarifs.planGratuit().getByRole('link', { name: 'Commencer gratuitement' })).toHaveAttribute('href', '/connexion')
        await sansDebordementHorizontal(p)
      }
      await p.getByRole('link', { name: 'Passer au plan payant' }).click()
      await expect(p).toHaveURL(/\/connexion/)
    } finally {
      await visiteur.close()
    }
  })
})
