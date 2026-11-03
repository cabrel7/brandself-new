import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { attendreHydration } from './helpers/hydratation'
import { BASE_URL, db, fermerConnexions } from './helpers/session'

// S7-bis : le flux de réservation passe désormais par la page publique
// /{username}/agenda (CA19/CA20) ; le GET /{username}/reserver sans paramètres
// répond 308 vers /{username}/agenda (CA22) ; /{username}/reserver?service&debut
// reste l'étape de confirmation inchangée.
//
// ATTENDU ROUGE : ces tests ne passeront qu'après la livraison backend + frontend
// S7-bis (page /agenda, nav, redirection 308). Pas de .skip : ils s'exécuteront
// volontairement en échec d'ici là.

const USERNAME_DEMO = 'dr-cabrel'
const JOURS_AGENDA_PUBLIC = 60
const MARGE_CRENEAU_STABLE_MS = 4 * 60 * 60 * 1000
const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

interface ServicePublic {
  slug: string
  titre: string
  type: string
  reservable: boolean
  dureeMin: number | null
}

interface CreneauxPublics {
  service: { id: string, slug: string, titre: string, dureeMin: number }
  fuseau: string
  creneaux: Array<{ debut: string, fin: string }>
}

interface FixtureReservation {
  service: ServicePublic
  reponse: CreneauxPublics
}

interface ContactPublic {
  nom: string
  email: string
  telephone: string
}

const emailsReservations = new Set<string>()
const emailsDemandes = new Set<string>()

function partieDate(date: Date, fuseau: string, type: Intl.DateTimeFormatPartTypes): string {
  const partie = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).find(item => item.type === type)
  if (!partie) throw new Error(`Partie de date ${type} introuvable.`)
  return partie.value
}

function dateLocale(value: string | Date, fuseau: string): string {
  const date = value instanceof Date ? value : new Date(value)
  return `${partieDate(date, fuseau, 'year')}-${partieDate(date, fuseau, 'month')}-${partieDate(date, fuseau, 'day')}`
}

function ajouterJours(date: string, jours: number): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  if (!annee || !mois || !jour) throw new Error(`Date locale invalide : ${date}`)
  return new Date(Date.UTC(annee, mois - 1, jour + jours)).toISOString().slice(0, 10)
}

function formaterHeure(iso: string, fuseau: string): string {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: fuseau,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const heure = Number(parties.find(partie => partie.type === 'hour')?.value ?? 0)
  const minute = parties.find(partie => partie.type === 'minute')?.value ?? '00'
  return minute === '00' ? `${heure} h` : `${heure} h ${minute}`
}

function formaterDateLongue(iso: string, fuseau: string): string {
  const texte = new Intl.DateTimeFormat('fr-FR', {
    timeZone: fuseau,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
  return texte.charAt(0).toLocaleUpperCase('fr-FR') + texte.slice(1)
}

function dateAccessible(iso: string, fuseau: string): string {
  const locale = dateLocale(iso, fuseau)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${locale}T12:00:00.000Z`))
}

function contactUnique(libelle: string): ContactPublic {
  const identifiant = randomUUID().replaceAll('-', '')
  const chiffres = (BigInt(`0x${identifiant.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, '0')
  return {
    nom: `${libelle} ${identifiant.slice(0, 8)}`,
    email: `e2e-s7-${identifiant}@example.com`,
    telephone: `+2376${chiffres}`,
  }
}

async function lireServices(api: APIRequestContext): Promise<{ fuseau: string, services: ServicePublic[] }> {
  const [vitrineResponse, servicesResponse] = await Promise.all([
    api.get(`/api/public/${USERNAME_DEMO}`),
    api.get(`/api/public/${USERNAME_DEMO}/services`),
  ])
  expect(vitrineResponse.status()).toBe(200)
  expect(servicesResponse.status()).toBe(200)
  const { vitrine } = (await vitrineResponse.json()) as { vitrine: { fuseau: string } }
  const { services } = (await servicesResponse.json()) as { services: ServicePublic[] }
  return { fuseau: vitrine.fuseau, services }
}

async function chargerReservation(api: APIRequestContext, indicePrioritaire = 0): Promise<FixtureReservation> {
  const { fuseau, services } = await lireServices(api)
  const du = dateLocale(new Date(), fuseau)
  const au = ajouterJours(du, JOURS_AGENDA_PUBLIC - 1)
  const candidats = services.filter(service =>
    service.reservable
    && service.dureeMin !== null
    && (service.type === 'rdv' || service.type === 'accompagnement'),
  )
  const prioritaire = candidats[indicePrioritaire]
  const candidatsOrdonnes = prioritaire
    ? [prioritaire, ...candidats.filter(service => service.slug !== prioritaire.slug)]
    : candidats
  for (const service of candidatsOrdonnes) {
    const response = await api.get(`/api/public/${USERNAME_DEMO}/creneaux`, {
      params: { service: service.slug, du, au },
    })
    expect(response.status(), await response.text()).toBe(200)
    const reponse = (await response.json()) as CreneauxPublics
    if (reponse.creneaux.length > 0) return { service, reponse }
  }
  throw new Error('Aucun créneau dynamique disponible pour le parcours public.')
}

function urlReservation(service: string, debut: string): string {
  const params = new URLSearchParams({ service, debut })
  return `/${USERNAME_DEMO}/reserver?${params.toString()}`
}

async function debutDansLien(lien: Locator): Promise<string | null> {
  const href = await lien.getAttribute('href')
  if (!href) throw new Error('Le lien de réservation ne contient pas de href.')
  return new URL(href, BASE_URL).searchParams.get('debut')
}

function choisirCreneauStable(reponse: CreneauxPublics): CreneauxPublics['creneaux'][number] | undefined {
  const limite = Date.now() + MARGE_CRENEAU_STABLE_MS
  return reponse.creneaux.find(creneau => Date.parse(creneau.debut) > limite) ?? reponse.creneaux.at(-1)
}

async function verifierChampRequis(champ: Locator, libelle: string): Promise<void> {
  await expect(champ, `${libelle} doit être exposé par son libellé`).toBeVisible()
  const semantiqueRequise = await champ.evaluate((element) =>
    element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
  )
  expect(semantiqueRequise, `${libelle} doit être annoncé comme requis`).toBe(true)
  const labelAssocie = await champ.evaluate((element) => {
    if (!(element instanceof HTMLInputElement) || !element.id) return false
    return document.querySelector(`label[for="${CSS.escape(element.id)}"]`) !== null
  })
  expect(labelAssocie, `${libelle} doit avoir un label HTML associé`).toBe(true)
}

async function verifierErreurAccessible(champ: Locator, texte: string): Promise<void> {
  await expect(champ).toHaveAttribute('aria-invalid', 'true')
  const description = await champ.evaluate((element) => {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ')
  })
  expect(description).toContain(texte)
}

async function verifierCibleTactile(element: Locator): Promise<void> {
  const boite = await element.boundingBox()
  expect(boite, 'la cible interactive doit être mesurable').not.toBeNull()
  expect(boite?.height ?? 0, 'la cible interactive doit mesurer au moins 44 px').toBeGreaterThanOrEqual(44)
}

async function verifierAbsencePii(page: Page, contact: ContactPublic): Promise<void> {
  const url = decodeURIComponent(page.url())
  const stockage = await page.evaluate(() => JSON.stringify(
    Array.from({ length: localStorage.length }, (_, index) => {
      const cle = localStorage.key(index) ?? ''
      return { cle, valeur: localStorage.getItem(cle) }
    }),
  ))
  for (const valeur of [contact.nom, contact.email, contact.telephone]) {
    expect(url).not.toContain(valeur)
    expect(stockage).not.toContain(valeur)
  }
}

function objetJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Le corps JSON attendu est absent ou invalide.')
  }
  return value as Record<string, unknown>
}

async function nettoyerParEmails(table: 'reservations' | 'demandes', emails: Set<string>): Promise<void> {
  const valeurs = [...emails]
  emails.clear()
  if (valeurs.length === 0) return

  const resultat = await db().query<{ id: string }>(
    `SELECT id FROM ${table} WHERE email = ANY($1::text[])`,
    [valeurs],
  )
  const ids = resultat.rows.map(row => row.id)
  if (ids.length === 0) return
  const type = table === 'reservations' ? 'reservation' : 'demande'
  await db().query(
    'DELETE FROM emails_transactionnels WHERE entite_type = $1 AND entite_id = ANY($2::text[])',
    [type, ids],
  )
  await db().query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [ids])
}

test.afterEach(async () => {
  await nettoyerParEmails('reservations', emailsReservations)
  await nettoyerParEmails('demandes', emailsDemandes)
})

test.afterAll(async () => {
  await fermerConnexions()
})

test('le même début ISO issu de GET créneaux relie l’accueil, le détail et le récapitulatif /reserver', async ({ page, request }) => {
  await page.setViewportSize(MOBILE)
  const { service, reponse } = await chargerReservation(request)

  await page.goto(`/${USERNAME_DEMO}`)
  const agenda = page.getByRole('region', { name: 'Réservez votre rendez-vous' })
  await expect(agenda).toBeVisible()
  const confirmer = agenda.getByRole('link', { name: /^Confirmer / })
  await expect(confirmer).toBeVisible()
  const debutAccueil = await debutDansLien(confirmer)
  if (!debutAccueil) throw new Error('ISO du créneau de l’accueil introuvable.')
  expect(reponse.creneaux.some(creneau => creneau.debut === debutAccueil)).toBe(true)

  await page.goto(`/${USERNAME_DEMO}/services/${service.slug}`)
  const prochains = page.getByRole('region', { name: 'Prochains créneaux' })
  await expect(prochains).toBeVisible()
  const debutsDetail = await prochains.getByRole('link').evaluateAll((liens) =>
    liens.map((lien) => new URL((lien as HTMLAnchorElement).href).searchParams.get('debut')),
  )
  expect(debutsDetail).toContain(debutAccueil)

  await page.goto(urlReservation(service.slug, debutAccueil))
  await expect(page.getByRole('heading', { level: 1, name: 'Plus qu’une étape pour réserver' })).toBeVisible()
  await expect(page.getByText(
    `${formaterDateLongue(debutAccueil, reponse.fuseau)}, ${formaterHeure(debutAccueil, reponse.fuseau)}`,
    { exact: true },
  )).toBeVisible()
  expect(new URL(page.url()).searchParams.get('debut')).toBe(debutAccueil)
})

test('un visiteur passe par /agenda, choisit service, jour et heure, confirme via /reserver et télécharge l’ICS', async ({ page, request }) => {
  await page.setViewportSize(MOBILE)
  const { service, reponse } = await chargerReservation(request, 1)
  const creneau = choisirCreneauStable(reponse)
  if (!creneau) throw new Error('Créneau stable du parcours /agenda introuvable.')

  await page.goto(`/${USERNAME_DEMO}/agenda`)
  await attendreHydration(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

  const selecteurService = page.getByRole('combobox', { name: 'Service à réserver' })
  await selecteurService.click()
  await page.getByRole('option').filter({ hasText: service.titre }).first().click()
  await expect(selecteurService).toContainText(service.titre)

  const jour = page.getByRole('button', { name: dateAccessible(creneau.debut, reponse.fuseau) })
  await jour.click()
  await expect(jour).toHaveAttribute('aria-pressed', 'true')
  await verifierCibleTactile(jour)

  const heure = page.getByRole('button', { name: formaterHeure(creneau.debut, reponse.fuseau), exact: true })
  await expect(heure).toBeVisible()
  await heure.click()
  await expect(heure).toHaveAttribute('aria-pressed', 'true')
  await verifierCibleTactile(heure)

  const continuer = page.getByRole('button', { name: /^Continuer / })
  await verifierCibleTactile(continuer)
  await continuer.click()

  await expect(page).toHaveURL(url =>
    url.pathname === `/${USERNAME_DEMO}/reserver`
    && url.searchParams.get('service') === service.slug
    && url.searchParams.get('debut') === creneau.debut,
  )
  const nom = page.getByLabel('Nom complet', { exact: true })
  const email = page.getByLabel('Email', { exact: true })
  const telephone = page.getByLabel('Téléphone ou WhatsApp', { exact: true })
  await verifierChampRequis(email, 'Email')
  await verifierChampRequis(telephone, 'Téléphone ou WhatsApp')
  await expect(page.getByText(/Payer en ligne/i)).toHaveCount(0)
  await expect(page.getByText('Rappel 24h', { exact: true })).toHaveCount(0)
  // S9 : le rappel est proposé au visiteur, désactivé par défaut (consentement explicite).
  const rappel = page.getByRole('switch', { name: /Recevoir un rappel par e-mail/ })
  await expect(rappel).toBeVisible()
  await expect(rappel).not.toBeChecked()
  await expect(page.getByText('24 heures avant le rendez-vous.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Payer sur place' })).toBeVisible()

  const envoyer = page.getByRole('button', { name: 'Envoyer ma demande' })
  await envoyer.click()
  await verifierErreurAccessible(email, 'Adresse email invalide.')
  await verifierErreurAccessible(telephone, 'Numéro de téléphone invalide.')

  const contact = contactUnique('Réservation navigateur')
  emailsReservations.add(contact.email)
  await nom.fill(contact.nom)
  await email.fill(contact.email)
  await telephone.fill(contact.telephone)
  await page.getByLabel('Motif de la consultation (facultatif)').fill('Contrôle E2E sans donnée réelle.')

  // Le corps est lu dans l'intercepteur : la page navigue vers la confirmation dès le 201, et
  // Chromium n'expose plus le corps d'une réponse dont la page a été quittée.
  let creation: { statut: number, texte: string } | undefined
  await page.route(`**/api/public/${USERNAME_DEMO}/reservations`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const reponseServeur = await route.fetch()
    creation = { statut: reponseServeur.status(), texte: await reponseServeur.text() }
    await route.fulfill({ response: reponseServeur })
  })
  await envoyer.click()
  await expect.poll(() => creation?.statut).toBe(201)
  const corpsCreation = JSON.parse(creation?.texte ?? '{}') as { reservation: { id: string, debut: string } }
  expect(corpsCreation.reservation.debut).toBe(creneau.debut)

  await expect(page).toHaveURL(`/${USERNAME_DEMO}/reserver/confirmation`)
  await expect(page.getByRole('heading', { level: 1, name: 'Votre demande est envoyée' })).toBeVisible({ timeout: 90_000 })
  const urlConfirmation = new URL(page.url())
  expect(urlConfirmation.search).toBe('')
  expect(urlConfirmation.hash).toBe('')
  const cookie = (await page.context().cookies()).find(item => item.name === 'brandself_confirmation')
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' })
  expect(cookie?.value.length ?? 0).toBeGreaterThan(20)

  const documentConfirmation = await page.context().request.get(
    `/${USERNAME_DEMO}/reserver/confirmation`,
    { headers: { Accept: 'text/html' } },
  )
  expect(documentConfirmation.status(), await documentConfirmation.text()).toBe(200)
  expect(documentConfirmation.headers()['content-type']).toContain('text/html')
  const cacheControl = documentConfirmation.headers()['cache-control']?.toLowerCase() ?? ''
  expect(cacheControl).toContain('private')
  expect(cacheControl).toContain('no-store')
  await verifierAbsencePii(page, contact)

  const telechargementPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Ajouter à mon agenda' }).click()
  const telechargement = await telechargementPromise
  expect(telechargement.suggestedFilename()).toBe('reservation-brandself.ics')
  expect(await telechargement.failure()).toBeNull()
})

test('un 409 réel garde les champs et recharge les créneaux sans créer une seconde réservation', async ({ page, request }) => {
  await page.setViewportSize(MOBILE)
  const { service, reponse } = await chargerReservation(request)
  const creneau = choisirCreneauStable(reponse)
  if (!creneau) throw new Error('Créneau du scénario 409 introuvable.')

  await page.goto(urlReservation(service.slug, creneau.debut))
  await attendreHydration(page)
  const visiteur = contactUnique('Visiteur conflit')
  const concurrent = contactUnique('Concurrent conflit')
  emailsReservations.add(visiteur.email)
  emailsReservations.add(concurrent.email)
  await page.getByLabel('Nom complet', { exact: true }).fill(visiteur.nom)
  await page.getByLabel('Email', { exact: true }).fill(visiteur.email)
  await page.getByLabel('Téléphone ou WhatsApp', { exact: true }).fill(visiteur.telephone)
  await page.getByLabel('Motif de la consultation (facultatif)').fill('Informations à conserver après conflit.')

  const prise = await request.post(`/api/public/${USERNAME_DEMO}/reservations`, {
    data: {
      serviceId: reponse.service.id,
      debut: creneau.debut,
      ...concurrent,
      motif: 'Réservation concurrente.',
      siteWeb: '',
      rappelEmail: false,
      paiementChoisi: 'sur_place',
    },
  })
  expect(prise.status(), await prise.text()).toBe(201)

  const conflitPromise = page.waitForResponse(reponseHttp =>
    reponseHttp.request().method() === 'POST'
    && new URL(reponseHttp.url()).pathname === `/api/public/${USERNAME_DEMO}/reservations`,
  )
  const rafraichissementPromise = page.waitForResponse(reponseHttp =>
    reponseHttp.request().method() === 'GET'
    && new URL(reponseHttp.url()).pathname === `/api/public/${USERNAME_DEMO}/creneaux`,
  )
  await page.getByRole('button', { name: 'Envoyer ma demande' }).click()
  const [conflit, rafraichissement] = await Promise.all([conflitPromise, rafraichissementPromise])
  expect(conflit.status()).toBe(409)
  expect(objetJson(await conflit.json())).toMatchObject({ data: { code: 'CRENEAU_PRIS' } })
  expect(rafraichissement.status()).toBe(200)
  const creneauxRafraichis = ((await rafraichissement.json()) as CreneauxPublics).creneaux
  expect(creneauxRafraichis.some(item => item.debut === creneau.debut)).toBe(false)

  await expect(page.getByRole('alert')).toContainText('Vos informations sont gardées')
  await expect(page.getByLabel('Nom complet', { exact: true })).toHaveValue(visiteur.nom)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(visiteur.email)
  await expect(page.getByLabel('Téléphone ou WhatsApp', { exact: true })).toHaveValue(visiteur.telephone)
  await expect(page.getByLabel('Motif de la consultation (facultatif)')).toHaveValue('Informations à conserver après conflit.')
  await expect(page.getByRole('button', { name: 'Envoyer ma demande' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Choisir un autre créneau' })).toBeVisible()
  await verifierAbsencePii(page, visiteur)
})

test('la nav publique mène vers /agenda et le GET /reserver sans paramètres redirige 308 (CA19, CA21, CA22)', async ({ page, request }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`/${USERNAME_DEMO}`)

  // L'accueil reste gelé : le bloc agenda y reste visible ; seul le lien de nav change.
  await expect(page.getByRole('region', { name: 'Réservez votre rendez-vous' })).toBeVisible()

  const navigation = page.getByRole('navigation', { name: 'Vitrine' })
  const lienAgenda = navigation.getByRole('link', { name: 'Agenda', exact: true })
  await expect(lienAgenda).toHaveAttribute('href', `/${USERNAME_DEMO}/agenda`)
  await lienAgenda.click()
  await expect(page).toHaveURL(new RegExp(`/${USERNAME_DEMO}/agenda$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

  // CA21 : recharger l'agenda avec un service ne casse pas la page ; les jours passés
  // du mois courant sont grisés et ne sont pas cliquables.
  const { service } = await chargerReservation(request)
  await page.goto(`/${USERNAME_DEMO}/agenda?service=${service.slug}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Continuer / })).toBeDisabled()

  // CA22 : le GET /reserver sans paramètres valide est réorienté en 308 vers /agenda.
  const reponseReserver = await page.context().request.get(`/${USERNAME_DEMO}/reserver`, { maxRedirects: 0 })
  expect(reponseReserver.status()).toBe(308)
  expect(reponseReserver.headers()['location']).toContain(`/${USERNAME_DEMO}/agenda`)
})

test('un atelier ou devis se demande depuis son détail et le formulaire envoie le slug public', async ({ page, request }) => {
  await page.setViewportSize(MOBILE)
  const { services } = await lireServices(request)
  const service = services.find(item => item.reservable && item.type === 'atelier')
    ?? services.find(item => item.reservable && item.type === 'devis')
  expect(service, 'le seed doit proposer un atelier ou un devis réservable').toBeDefined()
  if (!service) return

  await page.goto(`/${USERNAME_DEMO}/services/${service.slug}`)
  await attendreHydration(page)
  const action = service.type === 'atelier' ? 'S’inscrire' : 'Demander un devis'
  const titreFormulaire = service.type === 'atelier' ? 'Demandez votre inscription' : 'Parlez de votre besoin'
  const lienAction = page.getByRole('link', { name: action, exact: true }).first()
  const hrefAction = await lienAction.getAttribute('href')
  expect(new URL(hrefAction ?? '', BASE_URL).hash).toBe('#demande')
  await lienAction.click()
  const formulaire = page.getByRole('region', { name: titreFormulaire })
  await expect(formulaire).toBeVisible()

  const contact = contactUnique('Demande navigateur')
  emailsDemandes.add(contact.email)
  await formulaire.getByLabel('Nom complet', { exact: true }).fill(contact.nom)
  await formulaire.getByLabel('Email', { exact: true }).fill(contact.email)
  await formulaire.getByLabel('Téléphone ou WhatsApp', { exact: true }).fill(contact.telephone)
  await formulaire.getByLabel('Votre message (facultatif)').fill('Demande E2E sans donnée réelle.')

  const demandePromise = page.waitForResponse(reponseHttp =>
    reponseHttp.request().method() === 'POST'
    && new URL(reponseHttp.url()).pathname === `/api/public/${USERNAME_DEMO}/demandes`,
  )
  await formulaire.getByRole('button', { name: 'Envoyer ma demande' }).click()
  const demande = await demandePromise
  expect(demande.status(), await demande.text()).toBe(201)
  const corpsEnvoye = objetJson(demande.request().postDataJSON())
  expect(corpsEnvoye.service).toBe(service.slug)
  expect(corpsEnvoye).not.toHaveProperty('serviceId')
  expect(corpsEnvoye).not.toHaveProperty('type')
  const corpsRecu = objetJson(await demande.json())
  expect(corpsRecu).toMatchObject({ demande: { statut: 'nouvelle' } })
  await expect(page.getByRole('heading', { name: 'Votre demande est envoyée' })).toBeVisible()
  await verifierAbsencePii(page, contact)
})
