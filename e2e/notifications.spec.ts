import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { buildShareMessage, linkedinShareUrl, whatsappShareUrl } from '../shared/partage'
import { PROCHAINES_ETAPES } from '../shared/prochaine-etape'
import { ouvrirStudio } from './helpers/hydratation'
import { adresseUnique, creerVitrinePubliee, DESKTOP, MOBILE, ouvrirContexte, sansDebordementHorizontal, TABLETTE, VIEWPORTS } from './helpers/ia'
import {
  AccueilStudioPage, ANNONCE_PREFERENCES, BASE_URL, ComptePage, contactUnique, DELAI_ECRAN_MS, DesabonnementPage,
  ERREUR_ENREGISTREMENT, fixerPreferences, HOTE_VITRINES, jetonExpire, jetonValide, lireEtapesIgnorees, lirePartageeLe,
  lirePreferences, lireRappelReservation, nettoyerReservations, ORDRE_ETAPES, PartagePanneau, preparerProgressionSansIa,
  reinitialiserEtapes, ReservationPage, signerJeton, supprimerDonneesUtilisateur, trouverCreneau,
} from './helpers/notifications'
import type { Contact, CreneauReservable } from './helpers/notifications'
import { fermerConnexions, reinitialiserLimites, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

// S9 lot F2 : interface (CA58 à CA62, CA67), navigateur réel, mobile d'abord (390 px).
//
// Aucun parcours ne dépend de l'IA (vitrines créées par l'API, progression d'inscription écrite en base) ni du
// worker (on vérifie l'interface et la base, jamais l'envoi d'e-mails : voir e2e/api/notifications.spec.ts).
// Prérequis : serveur `pnpm dev` démarré, vitrine de démonstration `dr-cabrel` (`pnpm db:seed`) pour la réservation.
// Tests indépendants : l'état de départ (préférences, étapes ignorées) est refait en `beforeEach`.

const DELAI_TEST_MS = 240_000
const STATUT_SERVEUR = 500
const MESSAGE_COPIE = 'Message copié.'
const MESSAGE_LINKEDIN = 'Message copié : collez-le dans votre publication.'
const MESSAGE_ETAPE_MASQUEE = 'Étape masquée.'
const MESSAGE_ETAPE_ECHEC = 'Nous n’avons pas pu masquer cette étape. Réessayez dans un instant.'

test.describe('S9 interface : préférences, désabonnement, prochaine étape, partage, rappel', () => {
  let session: Session
  let contexte: BrowserContext
  let page: Page
  let username: string
  const emailsReservations = new Set<string>()

  test.beforeAll(async ({ playwright, browser }) => {
    test.setTimeout(DELAI_TEST_MS)
    session = await seConnecter(playwright)
    username = adresseUnique('s9ui')
    await creerVitrinePubliee(session, username)
    contexte = await ouvrirContexte(browser, session, { pressePapiers: true })
    page = await contexte.newPage()
  })

  test.beforeEach(async () => {
    test.setTimeout(DELAI_TEST_MS)
    await page.setViewportSize(MOBILE)
    await fixerPreferences(session.userId, { emailHebdo: true, emailRappelJour: true })
    await reinitialiserEtapes(session.userId)
  })

  test.afterEach(async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await nettoyerReservations(emailsReservations)
    emailsReservations.clear()
  })

  test.afterAll(async () => {
    await contexte?.close()
    await session?.api.dispose()
    await fermerConnexions()
  })

  // -------------------------------------------------------------------------------------------
  // (a) CA59 : Compte, partie « E-mails »
  // -------------------------------------------------------------------------------------------

  test('CA59 : les deux interrupteurs de la partie E-mails se bascule, annoncent « Préférences enregistrées. » et persistent', async () => {
    const compte = new ComptePage(page)
    await compte.ouvrir()

    // Interrupteurs (rôle switch), jamais de case à cocher.
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    for (const nom of ['Résumé de la semaine', 'Rendez-vous du jour'] as const) {
      await expect(compte.interrupteur(nom)).toBeVisible()
      await expect(compte.interrupteur(nom)).toHaveAttribute('aria-checked', 'true')
    }
    await expect(compte.partie().getByText('Chaque lundi matin, l’activité de votre vitrine en un coup d’œil.')).toBeVisible()
    await expect(compte.partie().getByText('Le matin, la liste de vos rendez-vous de la journée.')).toBeVisible()
    await expect(compte.partie().getByText('Les e-mails liés à vos réservations et à vos messages sont toujours envoyés : ils font partie du service.')).toBeVisible()

    const hebdo = compte.interrupteur('Résumé de la semaine')
    await hebdo.click()
    await expect(hebdo).toHaveAttribute('aria-checked', 'false')
    await expect(compte.annonce()).toHaveText(ANNONCE_PREFERENCES)
    await expect(compte.interrupteur('Rendez-vous du jour')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => lirePreferences(session.userId)).toEqual({ emailHebdo: false, emailRappelJour: true })

    // Le second interrupteur, au clavier (Espace).
    const rappelJour = compte.interrupteur('Rendez-vous du jour')
    await expect(rappelJour).toBeEnabled()
    await rappelJour.focus()
    await page.keyboard.press('Space')
    await expect(rappelJour).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => lirePreferences(session.userId)).toEqual({ emailHebdo: false, emailRappelJour: false })
    // Le focus revient à l'interrupteur une fois l'enregistrement terminé.
    await expect(rappelJour).toBeFocused()

    // Persistance au rechargement.
    await compte.ouvrir()
    await expect(compte.interrupteur('Résumé de la semaine')).toHaveAttribute('aria-checked', 'false')
    await expect(compte.interrupteur('Rendez-vous du jour')).toHaveAttribute('aria-checked', 'false')

    // Et on peut réactiver.
    await compte.interrupteur('Résumé de la semaine').click()
    await expect(compte.interrupteur('Résumé de la semaine')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => lirePreferences(session.userId)).toEqual({ emailHebdo: true, emailRappelJour: false })
  })

  test('CA59 : une 500 du serveur remet l’interrupteur et n’affiche qu’un seul message d’erreur', async () => {
    const compte = new ComptePage(page)
    await compte.ouvrir()

    await page.route('**/api/studio/moi', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      return route.fulfill({
        status: STATUT_SERVEUR,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: STATUT_SERVEUR, statusMessage: 'Erreur', message: 'Erreur interne', data: { code: 'INTERNE' } }),
      })
    })

    const hebdo = compte.interrupteur('Résumé de la semaine')
    await hebdo.click()
    // Un seul message d'erreur, dans la partie E-mails, et jamais l'annonce de succès.
    await expect(compte.partie().getByRole('alert')).toHaveText(ERREUR_ENREGISTREMENT)
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1)
    await expect(compte.partie().getByText(ANNONCE_PREFERENCES)).toHaveCount(0)
    // La valeur serveur revient, l'interrupteur est de nouveau actif et garde le focus.
    await expect(hebdo).toHaveAttribute('aria-checked', 'true')
    await expect(hebdo).toBeEnabled()
    await expect(hebdo).toBeFocused()
    expect(await lirePreferences(session.userId)).toEqual({ emailHebdo: true, emailRappelJour: true })

    // Après le retour du réseau, le même geste réussit et le message d'erreur disparaît.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await hebdo.click()
    await expect(hebdo).toHaveAttribute('aria-checked', 'false')
    await expect(compte.annonce()).toHaveText(ANNONCE_PREFERENCES)
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  })

  test('Compte : la partie E-mails tient à 390, 768 et 1280 px sans barre horizontale, cibles de 44 px', async () => {
    const compte = new ComptePage(page)
    await compte.ouvrir()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(compte.partie()).toBeVisible()
      await sansDebordementHorizontal(page, viewport.width)
      const zone = await compte.partie().getByRole('listitem').first().boundingBox()
      expect(zone?.height ?? 0, `ligne de préférence à ${viewport.width} px`).toBeGreaterThanOrEqual(44)
    }
  })

  // -------------------------------------------------------------------------------------------
  // (b) CA62 : formulaire de réservation publique
  // -------------------------------------------------------------------------------------------

  async function reserver(browser: Browser, creneau: CreneauReservable, contact: Contact, activerRappel: boolean): Promise<void> {
    const visiteur = await browser.newContext({ baseURL: BASE_URL, viewport: MOBILE })
    try {
      const p = await visiteur.newPage()
      const reservation = new ReservationPage(p)
      await reservation.ouvrir(creneau)

      // Désactivé par défaut (consentement explicite), description exacte.
      await expect(reservation.rappel()).toBeVisible()
      await expect(reservation.rappel()).toHaveAttribute('aria-checked', 'false')
      await expect(p.getByText('24 heures avant le rendez-vous.', { exact: true })).toBeVisible()
      await expect(p.getByRole('checkbox')).toHaveCount(0)

      emailsReservations.add(contact.email)
      await reservation.remplir(contact)
      if (activerRappel) {
        await reservation.rappel().click()
        await expect(reservation.rappel()).toHaveAttribute('aria-checked', 'true')
      }
      await reservation.envoyer().click()
      await expect(p).toHaveURL(`/dr-cabrel/reserver/confirmation`, { timeout: DELAI_ECRAN_MS })
    } finally {
      await visiteur.close()
    }
  }

  test('CA62 : rappel activé puis demande envoyée, reservations.rappel_email = true', async ({ browser, request }) => {
    await reinitialiserLimites('')
    const creneau = await trouverCreneau(request)
    const contact = contactUnique()
    await reserver(browser, creneau, contact, true)
    await expect.poll(() => lireRappelReservation(contact.email)).toBe(true)
  })

  test('CA62 : rappel laissé désactivé, reservations.rappel_email = false', async ({ browser, request }) => {
    await reinitialiserLimites('')
    const creneau = await trouverCreneau(request)
    const contact = contactUnique()
    await reserver(browser, creneau, contact, false)
    await expect.poll(() => lireRappelReservation(contact.email)).toBe(false)
  })

  test('CA62 : le formulaire de réservation ne déborde pas à 390, 768 et 1280 px', async ({ browser, request }) => {
    const creneau = await trouverCreneau(request)
    const visiteur = await browser.newContext({ baseURL: BASE_URL, viewport: MOBILE })
    try {
      const p = await visiteur.newPage()
      const reservation = new ReservationPage(p)
      await reservation.ouvrir(creneau)
      for (const viewport of VIEWPORTS) {
        await p.setViewportSize(viewport)
        await expect(reservation.rappel()).toBeVisible()
        await sansDebordementHorizontal(p, viewport.width)
      }
    } finally {
      await visiteur.close()
    }
  })

  // -------------------------------------------------------------------------------------------
  // (c) CA60 : /desabonnement
  // -------------------------------------------------------------------------------------------

  async function pageAnonyme(browser: Browser): Promise<{ p: Page, fermer: () => Promise<void> }> {
    // Aucune session : le jeton signé du lien fait foi.
    const anonyme = await browser.newContext({ baseURL: BASE_URL, viewport: MOBILE })
    return { p: await anonyme.newPage(), fermer: () => anonyme.close() }
  }

  test('CA60 : jeton valide, aperçu sans effet puis « Me désabonner » donne « C’est fait. », focus sur le titre, sans adresse e-mail', async ({ browser }) => {
    const { p, fermer } = await pageAnonyme(browser)
    try {
      const desabonnement = new DesabonnementPage(p)
      await desabonnement.ouvrir(jetonValide(session.userId, 'email_hebdo'))

      await expect(desabonnement.titre('Ne plus recevoir le résumé de la semaine ?')).toBeVisible({ timeout: DELAI_ECRAN_MS })
      await expect(desabonnement.titre('Ne plus recevoir le résumé de la semaine ?')).toBeFocused()
      await expect(p.getByText('Vous pourrez le réactiver à tout moment dans votre compte.')).toBeVisible()
      // L'aperçu n'a aucun effet.
      expect((await lirePreferences(session.userId)).emailHebdo).toBe(true)

      await desabonnement.action().click()
      await expect(desabonnement.titre('C’est fait.')).toBeVisible()
      await expect(desabonnement.titre('C’est fait.')).toBeFocused()
      await expect(p.getByText('Vous ne recevrez plus le résumé de la semaine.')).toBeVisible()
      await expect(p.getByRole('link', { name: 'Gérer mes e-mails' })).toHaveAttribute('href', '/studio/compte')
      await expect.poll(() => lirePreferences(session.userId)).toEqual({ emailHebdo: false, emailRappelJour: true })

      // L'adresse e-mail n'apparaît jamais.
      expect(await p.content()).not.toContain(session.email)
      expect(p.url()).not.toContain(session.email)
    } finally {
      await fermer()
    }
  })

  test('CA60 : le jeton « rendez-vous du jour » désabonne uniquement cette préférence', async ({ browser }) => {
    const { p, fermer } = await pageAnonyme(browser)
    try {
      const desabonnement = new DesabonnementPage(p)
      await desabonnement.ouvrir(jetonValide(session.userId, 'email_rappel_jour'))
      await expect(desabonnement.titre('Ne plus recevoir les rendez-vous du jour ?')).toBeVisible({ timeout: DELAI_ECRAN_MS })
      await desabonnement.action().click()
      await expect(desabonnement.titre('C’est fait.')).toBeVisible()
      await expect(p.getByText('Vous ne recevrez plus les rendez-vous du jour.')).toBeVisible()
      await expect.poll(() => lirePreferences(session.userId)).toEqual({ emailHebdo: true, emailRappelJour: false })
    } finally {
      await fermer()
    }
  })

  test('CA60 : jeton expiré, message d’expiration, lien de connexion, aucune action ni adresse e-mail', async ({ browser }) => {
    const { p, fermer } = await pageAnonyme(browser)
    try {
      const desabonnement = new DesabonnementPage(p)
      await desabonnement.ouvrir(jetonExpire(session.userId, 'email_hebdo'))

      await expect(desabonnement.titre('Ce lien a expiré.')).toBeVisible({ timeout: DELAI_ECRAN_MS })
      await expect(desabonnement.titre('Ce lien a expiré.')).toBeFocused()
      await expect(p.getByText('Vous pouvez gérer vos e-mails depuis votre compte.')).toBeVisible()
      // §7.6 : le lien mène à la connexion (le compte est derrière la connexion). CA60 dit « lien vers le compte ».
      await expect(p.getByRole('link', { name: 'Me connecter' })).toHaveAttribute('href', '/connexion')
      await expect(desabonnement.action()).toHaveCount(0)
      expect(await p.content()).not.toContain(session.email)
      expect((await lirePreferences(session.userId)).emailHebdo).toBe(true)
    } finally {
      await fermer()
    }
  })

  test('CA60 : jeton invalide (signature, charge modifiée, absent, illisible) donne « Ce lien n’est pas valide. »', async ({ browser }) => {
    const valide = jetonValide(session.userId, 'email_hebdo')
    const [version, charge, signature] = valide.split('.')
    const chargeModifiee = Buffer.from(
      JSON.stringify({ ...(JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')) as object), p: 'email_rappel_jour' }),
      'utf8',
    ).toString('base64url')
    const signatureAltérée = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`
    const cas: Array<{ nom: string, chemin: string }> = [
      { nom: 'signature altérée', chemin: `/desabonnement?jeton=${version}.${charge}.${signatureAltérée}` },
      { nom: 'charge modifiée', chemin: `/desabonnement?jeton=${version}.${chargeModifiee}.${signature}` },
      { nom: 'jeton absent', chemin: '/desabonnement' },
      { nom: 'jeton illisible', chemin: '/desabonnement?jeton=pas-un-jeton' },
    ]
    const { p, fermer } = await pageAnonyme(browser)
    try {
      for (const { nom, chemin } of cas) {
        await p.goto(chemin)
        const desabonnement = new DesabonnementPage(p)
        await expect(desabonnement.titre('Ce lien n’est pas valide.'), nom).toBeVisible({ timeout: DELAI_ECRAN_MS })
        await expect(desabonnement.titre('Ce lien n’est pas valide.'), nom).toBeFocused()
        await expect(desabonnement.action(), nom).toHaveCount(0)
        expect(await p.content()).not.toContain(session.email)
      }
      expect(await lirePreferences(session.userId)).toEqual({ emailHebdo: true, emailRappelJour: true })
    } finally {
      await fermer()
    }
  })

  test('CA60 : une panne du serveur affiche « Réessayer » et le désabonnement aboutit au second essai', async ({ browser }) => {
    const { p, fermer } = await pageAnonyme(browser)
    try {
      const desabonnement = new DesabonnementPage(p)
      let echecs = 1
      await p.route('**/api/public/desabonnement**', async (route) => {
        if (route.request().method() === 'POST' && echecs > 0) {
          echecs -= 1
          return route.fulfill({ status: STATUT_SERVEUR, contentType: 'application/json', body: '{"statusCode":500,"message":"Erreur"}' })
        }
        return route.continue()
      })
      await desabonnement.ouvrir(jetonValide(session.userId, 'email_hebdo'))
      await expect(desabonnement.action()).toBeVisible({ timeout: DELAI_ECRAN_MS })
      await desabonnement.action().click()
      await expect(p.getByRole('alert')).toHaveText('Nous n’avons pas pu enregistrer votre choix. Réessayez dans un instant.')
      expect((await lirePreferences(session.userId)).emailHebdo).toBe(true)
      await p.getByRole('button', { name: 'Réessayer' }).click()
      await expect(desabonnement.titre('C’est fait.')).toBeVisible()
      await expect.poll(() => lirePreferences(session.userId)).toEqual({ emailHebdo: false, emailRappelJour: true })
    } finally {
      await fermer()
    }
  })

  test('CA60 : /desabonnement ne déborde pas à 390, 768 et 1280 px (états valide, succès, expiré)', async ({ browser }) => {
    const { p, fermer } = await pageAnonyme(browser)
    try {
      const desabonnement = new DesabonnementPage(p)
      for (const viewport of VIEWPORTS) {
        await p.setViewportSize(viewport)
        await desabonnement.ouvrir(jetonValide(session.userId, 'email_hebdo'))
        await expect(desabonnement.action()).toBeVisible({ timeout: DELAI_ECRAN_MS })
        await sansDebordementHorizontal(p, viewport.width)
        const bouton = await desabonnement.action().boundingBox()
        expect(bouton?.height ?? 0, `bouton « Me désabonner » à ${viewport.width} px`).toBeGreaterThanOrEqual(44)
        await desabonnement.action().click()
        await expect(desabonnement.titre('C’est fait.')).toBeVisible()
        await sansDebordementHorizontal(p, viewport.width)

        await desabonnement.ouvrir(jetonExpire(session.userId, 'email_hebdo'))
        await expect(desabonnement.titre('Ce lien a expiré.')).toBeVisible()
        await sansDebordementHorizontal(p, viewport.width)
      }
    } finally {
      await fermer()
    }
  })

  test('CA60 : le jeton signé par le test est accepté par l’API (la copie du service reste compatible)', async ({ request }) => {
    const reponse = await request.get(`/api/public/desabonnement?jeton=${encodeURIComponent(jetonValide(session.userId, 'email_hebdo'))}`)
    expect(reponse.status()).toBe(200)
    expect(await reponse.json()).toEqual({ preference: 'email_hebdo' })
    const expire = await request.get(`/api/public/desabonnement?jeton=${encodeURIComponent(signerJeton(session.userId, 'email_hebdo', new Date(0)))}`)
    expect(expire.status()).toBe(410)
  })

  // -------------------------------------------------------------------------------------------
  // (d) CA58 / CA67 : prochaine étape au studio
  // -------------------------------------------------------------------------------------------

  test('CA58 / CA67 : « Ne plus proposer cette étape » au clavier, une seule carte, ordre photo, service, disponibilités, réalisation, partager', async () => {
    const accueil = new AccueilStudioPage(page)
    await accueil.ouvrir()

    for (const [indice, etape] of ORDRE_ETAPES.entries()) {
      // Une seule carte prochaine étape visible à tout moment.
      await expect(accueil.cartes()).toHaveCount(1)
      await expect(accueil.titreEtape(etape)).toBeVisible()
      await expect(page.getByText(PROCHAINES_ETAPES[etape].texte, { exact: true })).toBeVisible()
      await expect(accueil.ignorer()).toBeVisible()

      // Activation au clavier (Entrée), jamais à la souris.
      await accueil.ignorer().focus()
      await page.keyboard.press('Enter')

      await expect.poll(() => lireEtapesIgnorees(session.userId)).toContain(etape)
      const suivante = ORDRE_ETAPES[indice + 1]
      if (suivante) {
        await expect(accueil.titreEtape(suivante)).toBeVisible()
        await expect(accueil.titreEtape(suivante)).toBeFocused()
        await expect(accueil.titreEtape(etape)).toHaveCount(0)
        await expect(accueil.cartes()).toHaveCount(1)
      }
      await expect(page.getByRole('status').filter({ hasText: MESSAGE_ETAPE_MASQUEE })).toHaveCount(1)

      if (indice === 0) {
        // Après rechargement, l'étape ignorée n'apparaît pas.
        await accueil.ouvrir()
        await expect(accueil.titreEtape('photo')).toHaveCount(0)
        await expect(accueil.titreEtape('service')).toBeVisible()
        await expect(accueil.cartes()).toHaveCount(1)
      }
    }

    // Plus aucune étape : 0 carte, le focus passe au titre « Votre vitrine ».
    await expect(accueil.cartes()).toHaveCount(0)
    await expect(accueil.titreListe()).toBeFocused()
    expect(await lireEtapesIgnorees(session.userId)).toEqual([...ORDRE_ETAPES])

    await accueil.ouvrir()
    await expect(accueil.cartes()).toHaveCount(0)
  })

  test('CA58 : le bouton « Ne plus proposer cette étape » mesure au moins 44 px et la carte ne déborde pas à 390, 768, 1280 px', async () => {
    const accueil = new AccueilStudioPage(page)
    await accueil.ouvrir()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(accueil.ignorer()).toBeVisible()
      await sansDebordementHorizontal(page, viewport.width)
      const boite = await accueil.ignorer().boundingBox()
      expect(boite?.height ?? 0, `cible du bouton à ${viewport.width} px`).toBeGreaterThanOrEqual(44)
    }
  })

  test('CA58 : un échec de « ignorer » garde la carte et affiche un seul message', async () => {
    const accueil = new AccueilStudioPage(page)
    await accueil.ouvrir()
    await page.route('**/api/studio/prochaine-etape/ignorer', (route) =>
      route.fulfill({ status: STATUT_SERVEUR, contentType: 'application/json', body: '{"statusCode":500,"message":"Erreur"}' }),
    )
    await accueil.ignorer().click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1)
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(MESSAGE_ETAPE_ECHEC)
    await expect(accueil.cartes()).toHaveCount(1)
    await expect(accueil.titreEtape('photo')).toBeVisible()
    expect(await lireEtapesIgnorees(session.userId)).toEqual([])
  })

  // -------------------------------------------------------------------------------------------
  // (e) CA61 : partage
  // -------------------------------------------------------------------------------------------

  function messageAttendu(): string {
    // creerVitrinePubliee : prénom « Autre », métier « Avocat » ; disponibilités fermées : message sans réservation.
    return buildShareMessage({ prenom: 'Autre', metier: 'Avocat', url: `https://${HOTE_VITRINES}/${username}`, reservable: false })
  }

  test('CA61 : le panneau de partage propose message, WhatsApp, LinkedIn, copie et QR code ; « Message copié. » avec icône ; Échap rend le focus', async () => {
    const accueil = new AccueilStudioPage(page)
    const panneau = new PartagePanneau(page)
    await accueil.ouvrir()

    await accueil.partager().click()
    await expect(panneau.dialogue()).toBeVisible()
    await expect(panneau.dialogue().getByText(messageAttendu(), { exact: true })).toBeVisible()
    await expect(panneau.whatsapp()).toHaveAttribute('href', whatsappShareUrl(messageAttendu()))
    await expect(panneau.linkedin()).toHaveAttribute('href', linkedinShareUrl(`https://${HOTE_VITRINES}/${username}`))
    await expect(panneau.copier()).toBeVisible()
    await expect(panneau.qr()).toBeVisible()
    await expect(panneau.telecharger()).toBeVisible()
    await expect(panneau.dialogue().getByRole('checkbox')).toHaveCount(0)
    await sansDebordementHorizontal(page, MOBILE.width)

    // Aucun partage enregistré avant le premier geste.
    expect(await lirePartageeLe(session.userId)).toBeNull()

    await panneau.copier().click()
    await expect(panneau.annonce()).toHaveText(MESSAGE_COPIE)
    // L'annonce est accompagnée d'une icône (pas de couleur seule).
    await expect(panneau.annonce().locator('[class*="check-circle"]')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(messageAttendu())
    await expect.poll(() => lirePartageeLe(session.userId)).not.toBeNull()
    const premiere = await lirePartageeLe(session.userId)

    // Le focus est piégé dans le dialogue.
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)

    // Échap ferme et rend le focus au déclencheur ; une seconde copie ne change pas la première date.
    await page.keyboard.press('Escape')
    await expect(panneau.dialogue()).toHaveCount(0)
    await expect(accueil.partager()).toBeFocused()
    expect(await lirePartageeLe(session.userId)).toEqual(premiere)
  })

  test('CA61 : « Partager sur LinkedIn » copie le message, l’annonce et ouvre LinkedIn dans un autre onglet', async () => {
    const accueil = new AccueilStudioPage(page)
    const panneau = new PartagePanneau(page)
    // Aucun appel réseau réel vers LinkedIn.
    await contexte.route('**://www.linkedin.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>LinkedIn</title>' }))
    try {
      await accueil.ouvrir()
      await accueil.partager().click()
      await expect(panneau.dialogue()).toBeVisible()
      const [popup] = await Promise.all([page.waitForEvent('popup'), panneau.linkedin().click()])
      expect(popup.url()).toBe(linkedinShareUrl(`https://${HOTE_VITRINES}/${username}`))
      await popup.close()
      await expect(panneau.annonce()).toHaveText(MESSAGE_LINKEDIN)
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(messageAttendu())
      await expect.poll(() => lirePartageeLe(session.userId)).not.toBeNull()
    } finally {
      await contexte.unroute('**://www.linkedin.com/**')
    }
  })

  test('CA61 : le panneau de partage ne déborde pas à 390, 768 et 1280 px', async () => {
    const accueil = new AccueilStudioPage(page)
    const panneau = new PartagePanneau(page)
    await accueil.ouvrir()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await accueil.partager().click()
      await expect(panneau.dialogue()).toBeVisible()
      await expect(panneau.qr()).toBeVisible()
      await sansDebordementHorizontal(page, viewport.width)
      for (const bouton of [panneau.copier(), panneau.telecharger()]) {
        const boite = await bouton.boundingBox()
        expect(boite?.height ?? 0, `cible à ${viewport.width} px`).toBeGreaterThanOrEqual(44)
      }
      await page.keyboard.press('Escape')
      await expect(panneau.dialogue()).toHaveCount(0)
    }
  })

  test('CA61 : l’étape « Partagez votre vitrine » ouvre le panneau (sans navigation)', async () => {
    const accueil = new AccueilStudioPage(page)
    const panneau = new PartagePanneau(page)
    // On masque les étapes précédentes pour arriver à « partager ».
    await ouvrirStudio(page, '/studio')
    for (const etape of ORDRE_ETAPES.slice(0, -1)) {
      const reponse = await session.api.post('/api/studio/prochaine-etape/ignorer', { data: { etape } })
      expect(reponse.status()).toBe(200)
    }
    await accueil.ouvrir()
    await expect(accueil.titreEtape('partager')).toBeVisible()
    await page.getByRole('button', { name: PROCHAINES_ETAPES.partager.action, exact: true }).click()
    await expect(panneau.dialogue()).toBeVisible()
    await expect(page).toHaveURL(/\/studio$/)
    await panneau.copier().click()
    await expect(panneau.annonce()).toHaveText(MESSAGE_COPIE)
    await page.keyboard.press('Escape')
    // Le partage est enregistré : la carte « Partagez votre vitrine » disparaît, le focus reste dans la page.
    await expect(accueil.cartes()).toHaveCount(0)
    await expect(accueil.titreEtape('partager')).toHaveCount(0)
  })

  // -------------------------------------------------------------------------------------------
  // (e) CA61 : écran « C'est en ligne » après publication
  // -------------------------------------------------------------------------------------------

  test('CA61 : après publication, « C’est en ligne. » propose « Autres façons de partager » ; Échap rend le focus ; 390 px sans barre horizontale', async ({ playwright, browser }) => {
    const sessionB = await seConnecter(playwright)
    const contexteB = await ouvrirContexte(browser, sessionB, { pressePapiers: true })
    try {
      await preparerProgressionSansIa(sessionB)
      const p = await contexteB.newPage()
      const adresse = adresseUnique('s9enligne')
      await ouvrirStudio(p, '/onboarding')
      const champAdresse = p.getByLabel('Votre adresse')
      await expect(champAdresse).toBeVisible({ timeout: DELAI_ECRAN_MS })
      await champAdresse.fill(adresse)
      const publier = p.getByRole('button', { name: 'Publier ma vitrine', exact: true })
      await expect(publier).not.toHaveAttribute('aria-disabled', 'true', { timeout: DELAI_ECRAN_MS })
      await publier.click()

      const titre = p.getByRole('heading', { level: 1, name: 'C’est en ligne.' })
      await expect(titre).toBeVisible({ timeout: DELAI_ECRAN_MS })
      await expect(titre).toBeFocused()
      await expect(p.getByText(`${HOTE_VITRINES}/${adresse}`, { exact: true })).toBeVisible()

      const autres = p.getByRole('button', { name: 'Autres façons de partager' })
      await expect(autres).toBeVisible()
      await autres.click()
      const panneau = new PartagePanneau(p)
      await expect(panneau.dialogue()).toBeVisible()
      const message = buildShareMessage({
        prenom: 'Cabrel', metier: 'Cardiologue interventionnel', url: `https://${HOTE_VITRINES}/${adresse}`, reservable: false,
      })
      await expect(panneau.dialogue().getByText(message, { exact: true })).toBeVisible()
      await expect(panneau.whatsapp()).toHaveAttribute('href', whatsappShareUrl(message))
      await expect(panneau.linkedin()).toBeVisible()
      await expect(panneau.copier()).toBeVisible()
      await expect(panneau.qr()).toBeVisible()
      await sansDebordementHorizontal(p, MOBILE.width)

      await panneau.copier().click()
      await expect(panneau.annonce()).toHaveText(MESSAGE_COPIE)
      await expect(panneau.annonce().locator('[class*="check-circle"]')).toBeVisible()

      await p.keyboard.press('Escape')
      await expect(panneau.dialogue()).toHaveCount(0)
      await expect(autres).toBeFocused()

      for (const viewport of [TABLETTE, DESKTOP]) {
        await p.setViewportSize(viewport)
        await sansDebordementHorizontal(p, viewport.width)
      }
    } finally {
      await supprimerDonneesUtilisateur(sessionB.userId)
      await contexteB.close()
      await sessionB.api.dispose()
    }
  })
})
