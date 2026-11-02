import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { attendreErreur, db, fermerConnexions } from '../helpers/session'

const USERNAME_DEMO = 'dr-cabrel'
const JOURS_AGENDA_PUBLIC = 60

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

interface FixtureAgenda {
  service: ServicePublic
  reponse: CreneauxPublics
  du: string
  au: string
}

interface ContactPublic {
  nom: string
  email: string
  telephone: string
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

function contactUnique(libelle: string): ContactPublic {
  const identifiant = randomUUID().replaceAll('-', '')
  const chiffres = (BigInt(`0x${identifiant.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, '0')
  return {
    nom: `${libelle} ${identifiant.slice(0, 8)}`,
    email: `e2e-s7-${identifiant}@example.com`,
    telephone: `+2376${chiffres}`,
  }
}

async function chargerFixtureAgenda(request: APIRequestContext): Promise<FixtureAgenda> {
  const [vitrineResponse, servicesResponse] = await Promise.all([
    request.get(`/api/public/${USERNAME_DEMO}`),
    request.get(`/api/public/${USERNAME_DEMO}/services`),
  ])
  expect(vitrineResponse.status()).toBe(200)
  expect(servicesResponse.status()).toBe(200)

  const { vitrine } = (await vitrineResponse.json()) as { vitrine: { fuseau: string } }
  const { services } = (await servicesResponse.json()) as { services: ServicePublic[] }
  const candidats = services.filter(service =>
    service.reservable
    && service.dureeMin !== null
    && (service.type === 'rdv' || service.type === 'accompagnement'),
  )
  expect(candidats.length, 'le seed doit proposer au moins un service réservable').toBeGreaterThan(0)

  const du = dateLocale(new Date(), vitrine.fuseau)
  const au = ajouterJours(du, JOURS_AGENDA_PUBLIC - 1)
  for (const service of candidats) {
    const response = await request.get(`/api/public/${USERNAME_DEMO}/creneaux`, {
      params: { service: service.slug, du, au },
    })
    expect(response.status(), await response.text()).toBe(200)
    const reponse = (await response.json()) as CreneauxPublics
    if (reponse.creneaux.length > 0) return { service, reponse, du, au }
  }
  throw new Error('Aucun créneau dynamique disponible dans le seed dr-cabrel.')
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

test('GET créneaux expose les disponibilités ISO dynamiques du seed dr-cabrel', async ({ request }) => {
  const { service, reponse, du, au } = await chargerFixtureAgenda(request)

  expect(du).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(au).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(reponse.service).toMatchObject({
    slug: service.slug,
    titre: service.titre,
    dureeMin: service.dureeMin,
  })
  expect(reponse.service.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(reponse.fuseau).toBe('Africa/Douala')
  expect(reponse.creneaux.length).toBeGreaterThan(0)

  const debuts = reponse.creneaux.map(creneau => Date.parse(creneau.debut))
  expect(debuts.every(Number.isFinite)).toBe(true)
  expect(debuts).toEqual([...debuts].sort((a, b) => a - b))
  for (const creneau of reponse.creneaux) {
    expect(new Date(creneau.debut).toISOString()).toBe(creneau.debut)
    expect(new Date(creneau.fin).toISOString()).toBe(creneau.fin)
    expect(Date.parse(creneau.fin)).toBeGreaterThan(Date.parse(creneau.debut))
  }
})

test('deux POST simultanés sur le même créneau produisent exactement 201 et 409, sans double réservation', async ({ request }) => {
  const { reponse, service, du, au } = await chargerFixtureAgenda(request)
  const creneau = reponse.creneaux.at(-1)
  if (!creneau) throw new Error('Créneau de concurrence introuvable.')

  const premier = contactUnique('Concurrent A')
  const second = contactUnique('Concurrent B')
  emailsANettoyer.add(premier.email)
  emailsANettoyer.add(second.email)
  const commun = {
    serviceId: reponse.service.id,
    debut: creneau.debut,
    siteWeb: '',
    rappelEmail: false,
    paiementChoisi: 'sur_place',
    motif: 'Test de concurrence réelle.',
  }

  const [reponseA, reponseB] = await Promise.all([
    request.post(`/api/public/${USERNAME_DEMO}/reservations`, { data: { ...commun, ...premier } }),
    request.post(`/api/public/${USERNAME_DEMO}/reservations`, { data: { ...commun, ...second } }),
  ])

  expect([reponseA.status(), reponseB.status()].sort((a, b) => a - b)).toEqual([201, 409])
  const succes = reponseA.status() === 201 ? reponseA : reponseB
  const conflit = reponseA.status() === 409 ? reponseA : reponseB
  const creee = (await succes.json()) as {
    reservation: { id: string, statut: string, debut: string, fin: string }
    confirmation: { expireLe: string }
  }
  expect(creee.reservation).toMatchObject({ statut: 'en_attente', debut: creneau.debut, fin: creneau.fin })
  expect(Date.parse(creee.confirmation.expireLe)).toBeGreaterThan(Date.now())
  await attendreErreur(conflit, 409, 'CRENEAU_PRIS')

  const persistantes = await db().query<{ id: string, email: string }>(
    `SELECT r.id, r.email
       FROM reservations r
       INNER JOIN vitrines v ON v.id = r.vitrine_id
      WHERE v.username = $1
        AND r.debut = $2::timestamptz
        AND r.email = ANY($3::text[])`,
    [USERNAME_DEMO, creneau.debut, [premier.email, second.email]],
  )
  expect(persistantes.rows).toHaveLength(1)
  expect(persistantes.rows[0]?.id).toBe(creee.reservation.id)

  const apres = await request.get(`/api/public/${USERNAME_DEMO}/creneaux`, {
    params: { service: service.slug, du, au },
  })
  expect(apres.status()).toBe(200)
  const creneauxApres = ((await apres.json()) as CreneauxPublics).creneaux
  expect(creneauxApres.some(item => item.debut === creneau.debut)).toBe(false)
})
