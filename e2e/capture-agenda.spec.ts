import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { attendreHydration } from './helpers/hydratation'
import { db, fermerConnexions } from './helpers/session'

// S7-bis : les captures portent désormais sur la page publique /{username}/agenda
// (le formulaire de confirmation reste capturé tel quel, inchangé).
//
// ATTENDU ROUGE : ces captures nécessitent la page /agenda livrée côté frontend.

const USERNAME_DEMO = 'dr-cabrel'
const JOURS_AGENDA_PUBLIC = 60
const MARGE_CRENEAU_STABLE_MS = 4 * 60 * 60 * 1000

const VUES = [
  { nom: 'mobile', taille: { width: 390, height: 844 } },
  { nom: 'tablette', taille: { width: 768, height: 1024 } },
  { nom: 'desktop', taille: { width: 1280, height: 800 } },
] as const

interface ServicePublic {
  slug: string
  type: string
  reservable: boolean
  dureeMin: number | null
}

interface CreneauxPublics {
  service: { id: string, slug: string }
  creneaux: Array<{ debut: string, fin: string }>
}

interface FixtureReservation {
  service: ServicePublic
  reponse: CreneauxPublics
}

const emailsANettoyer = new Set<string>()

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

function dateLocale(date: Date, fuseau: string): string {
  return `${partieDate(date, fuseau, 'year')}-${partieDate(date, fuseau, 'month')}-${partieDate(date, fuseau, 'day')}`
}

function ajouterJours(date: string, jours: number): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  if (!annee || !mois || !jour) throw new Error(`Date locale invalide : ${date}`)
  return new Date(Date.UTC(annee, mois - 1, jour + jours)).toISOString().slice(0, 10)
}

async function chargerReservation(api: APIRequestContext): Promise<FixtureReservation> {
  const [vitrineResponse, servicesResponse] = await Promise.all([
    api.get(`/api/public/${USERNAME_DEMO}`),
    api.get(`/api/public/${USERNAME_DEMO}/services`),
  ])
  expect(vitrineResponse.status()).toBe(200)
  expect(servicesResponse.status()).toBe(200)
  const { vitrine } = (await vitrineResponse.json()) as { vitrine: { fuseau: string } }
  const { services } = (await servicesResponse.json()) as { services: ServicePublic[] }
  const du = dateLocale(new Date(), vitrine.fuseau)
  const au = ajouterJours(du, JOURS_AGENDA_PUBLIC - 1)
  const candidats = services.filter(service =>
    service.reservable
    && service.dureeMin !== null
    && (service.type === 'rdv' || service.type === 'accompagnement'),
  )
  for (const service of candidats) {
    const response = await api.get(`/api/public/${USERNAME_DEMO}/creneaux`, {
      params: { service: service.slug, du, au },
    })
    expect(response.status(), await response.text()).toBe(200)
    const reponse = (await response.json()) as CreneauxPublics
    if (reponse.creneaux.length > 0) return { service, reponse }
  }
  throw new Error('Aucun créneau dynamique disponible pour les captures.')
}

function choisirCreneauStable(reponse: CreneauxPublics): CreneauxPublics['creneaux'][number] | undefined {
  const limite = Date.now() + MARGE_CRENEAU_STABLE_MS
  return reponse.creneaux.find(creneau => Date.parse(creneau.debut) > limite) ?? reponse.creneaux.at(-1)
}

function contactCapture(): { nom: string, email: string, telephone: string } {
  const identifiant = randomUUID().replaceAll('-', '')
  const chiffres = (BigInt(`0x${identifiant.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, '0')
  return {
    nom: `Capture réservation ${identifiant.slice(0, 8)}`,
    email: `e2e-s7-capture-${identifiant}@example.com`,
    telephone: `+2376${chiffres}`,
  }
}

async function stabiliser(page: Page): Promise<void> {
  await attendreHydration(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function verifierSansDebordement(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    largeurContenu: document.documentElement.scrollWidth,
    largeurVisible: document.documentElement.clientWidth,
  }))
  expect(dimensions.largeurContenu, 'la page ne doit pas déborder horizontalement').toBeLessThanOrEqual(dimensions.largeurVisible)
}

async function nettoyerReservations(): Promise<void> {
  const emails = [...emailsANettoyer]
  emailsANettoyer.clear()
  if (emails.length === 0) return
  const resultat = await db().query<{ id: string }>(
    'SELECT id FROM reservations WHERE email = ANY($1::text[])',
    [emails],
  )
  const ids = resultat.rows.map(row => row.id)
  if (ids.length === 0) return
  await db().query(
    "DELETE FROM emails_transactionnels WHERE entite_type = 'reservation' AND entite_id = ANY($1::text[])",
    [ids],
  )
  await db().query('DELETE FROM reservations WHERE id = ANY($1::text[])', [ids])
}

test.afterEach(nettoyerReservations)

test.afterAll(async () => {
  await fermerConnexions()
})

test.describe('captures publiques de l’agenda et de la réservation', () => {
  for (const vue of VUES) {
    test(`capture de /agenda sans overflow à ${vue.taille.width} px`, async ({ page }) => {
      await page.setViewportSize(vue.taille)
      const { service, reponse } = await chargerReservation(page.context().request)
      const creneau = choisirCreneauStable(reponse)
      if (!creneau) throw new Error('Créneau de capture introuvable.')

      await page.goto(`/${USERNAME_DEMO}/agenda?service=${service.slug}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Service à réserver' })).toBeVisible()
      await stabiliser(page)
      await verifierSansDebordement(page)
      await page.screenshot({ path: `capture-agenda-${vue.nom}.png`, fullPage: true })
    })
  }

  test('capture mobile de la confirmation obtenue par son cookie HttpOnly', async ({ page }) => {
    await page.setViewportSize(VUES[0].taille)
    const { reponse } = await chargerReservation(page.context().request)
    const creneau = choisirCreneauStable(reponse)
    if (!creneau) throw new Error('Créneau de confirmation introuvable.')
    const contact = contactCapture()
    emailsANettoyer.add(contact.email)

    const creation = await page.context().request.post(`/api/public/${USERNAME_DEMO}/reservations`, {
      data: {
        serviceId: reponse.service.id,
        debut: creneau.debut,
        ...contact,
        motif: 'Capture E2E sans donnée réelle.',
        siteWeb: '',
        rappelEmail: false,
        paiementChoisi: 'sur_place',
      },
    })
    expect(creation.status(), await creation.text()).toBe(201)
    const cookie = (await page.context().cookies()).find(item => item.name === 'brandself_confirmation')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' })

    await page.goto(`/${USERNAME_DEMO}/reserver/confirmation`)
    await expect(page.getByRole('heading', { level: 1, name: 'Votre demande est envoyée' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ajouter à mon agenda' })).toBeVisible()
    await stabiliser(page)
    await verifierSansDebordement(page)
    await page.screenshot({ path: 'capture-reservation-confirmation-mobile.png', fullPage: true })
  })

  for (const vue of VUES) {
    test(`capture de l’accueil agenda sans overflow à ${vue.taille.width} px`, async ({ page }) => {
      await page.setViewportSize(vue.taille)
      await page.goto(`/${USERNAME_DEMO}`)
      await expect(page.getByRole('region', { name: 'Réservez votre rendez-vous' })).toBeVisible()
      await stabiliser(page)
      await verifierSansDebordement(page)
      await page.screenshot({ path: `capture-accueil-agenda-${vue.nom}.png`, fullPage: true })
    })
  }
})
