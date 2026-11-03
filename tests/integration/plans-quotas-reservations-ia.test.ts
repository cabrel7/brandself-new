import { beforeEach, describe, expect, it } from 'vitest'
import { PLANS } from '../../server/config/plans'
import { creerContexteAgenda, insererDisponibilite, iso } from './support/agenda'
import { ajouterServices, jours, plus, poserAbonnement, SECONDE_MS, viderServices } from './support/abonnements'
import { rejet } from './support/erreurs'
import { createUser, empreinteDeTest, insertGeneration, insertService, insertVitrineRow } from './support/fabriques'
import { demandesService, creneauxService, reservationsService, vitrinesService } from './support/modules'
import { insererReservation, utc } from './support/notifications'
import { iaAmeliorer, lireGeneration, lireGenerationsDe, reinitialiserIa } from './support/ia'
import { schemaAmeliorerInput } from '../../shared/schemas/ia'

// S10 §6 CA82 à CA88 et #124/#125/#126 : quotas de réservations du mois (fuseau de la vitrine) et d'IA (fuseau du compte),
// contre la VRAIE base et le VRAI Redis. L'horloge est injectée dans les services (`maintenant`, `now`).

beforeEach(reinitialiserIa)

const LIMITE_RESERVATIONS = PLANS.gratuit.reservationsParMois ?? 0
const LIMITE_IA = PLANS.gratuit.generationsIaParMois ?? 0
const VISITEUR = { nom: 'Alice Visiteur', email: 'alice.visiteur@exemple.test', telephone: '+237699000002', note: 'Première consultation', paiementChoisi: 'sur_place' as const, rappelEmail: false }

async function vitrineReservable(options: { username?: string } = {}) {
  const contexte = await creerContexteAgenda({ ...options })
  await insererDisponibilite(contexte.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '14:00' })
  return contexte
}

/** Lundis à 09:00 locale (08:00Z) strictement dans le futur de `depuis` + 3 jours. */
function lundis(depuis: Date, n: number): Date[] {
  const resultat: Date[] = []
  const jour = new Date(Date.UTC(depuis.getUTCFullYear(), depuis.getUTCMonth(), depuis.getUTCDate() + 3, 8, 0, 0))
  while (jour.getUTCDay() !== 1) jour.setUTCDate(jour.getUTCDate() + 1)
  for (let i = 0; i < n; i += 1) resultat.push(new Date(jour.getTime() + i * 7 * 86_400_000))
  return resultat
}

async function remplir(vitrineId: string, serviceId: string, creeLe: Date, nombre: number, statut: 'en_attente' | 'confirmee' | 'terminee' | 'annulee' | 'refusee' = 'confirmee', decalage = 0) {
  for (let i = 0; i < nombre; i += 1) {
    await insererReservation(vitrineId, serviceId, { debut: utc(`2026-10-${String(1 + decalage + i).padStart(2, '0')}T08:00:00.000Z`), statut, createdAt: creeLe })
  }
}

const reserver = async (username: string, slug: string, debut: Date, maintenant: Date) => {
  const { createReservation } = await reservationsService()
  return createReservation(username, { serviceSlug: slug, debut: iso(debut), ...VISITEUR }, maintenant)
}

describe('réservations du mois : plan gratuit (CA82, CA83)', () => {
  it('should refuse the 11th booking of the month with 409 RESERVATIONS_INDISPONIBLES, never mentioning a plan (CA82)', async () => {
    const { vitrine, service } = await vitrineReservable()
    await remplir(vitrine.id, service.id, utc('2026-11-10T08:00:00.000Z'), LIMITE_RESERVATIONS)

    const erreur = await rejet(reserver(vitrine.username, service.slug, utc('2026-12-07T08:00:00.000Z'), utc('2026-11-30T22:30:00.000Z')))

    expect(erreur).toMatchObject({ code: 'RESERVATIONS_INDISPONIBLES', status: 409 })
    expect(erreur.message).not.toMatch(/plan|abonnement|gratuit|payant/i)
    expect(JSON.stringify(erreur.data ?? {})).not.toMatch(/plan|limite/i)
  })

  it('should accept the booking at 00:30 on the 1st in the vitrine time zone : the new month starts at local midnight (CA82)', async () => {
    const { vitrine, service } = await vitrineReservable()
    await remplir(vitrine.id, service.id, utc('2026-11-10T08:00:00.000Z'), LIMITE_RESERVATIONS)

    const creee = await reserver(vitrine.username, service.slug, utc('2026-12-07T08:00:00.000Z'), utc('2026-11-30T23:30:00.000Z'))

    expect(creee.reservation.statut).toBe('en_attente')
  })

  it('should count by the local month : a booking made on 31 October at 23:30 local belongs to October, not November', async () => {
    const { vitrine, service } = await vitrineReservable()
    // 2026-10-31T22:30Z = 23:30 locale le 31 octobre : octobre. Aucune réservation de novembre.
    await remplir(vitrine.id, service.id, utc('2026-10-31T22:30:00.000Z'), LIMITE_RESERVATIONS)

    const creee = await reserver(vitrine.username, service.slug, utc('2026-11-16T08:00:00.000Z'), utc('2026-11-03T13:00:00.000Z'))

    expect(creee.reservation.id).toBeTruthy()
  })

  it('should not count refused and cancelled bookings : 9 active + 3 refused/cancelled -> the 10th is accepted, the 11th refused (CA83)', async () => {
    const maintenant = new Date()
    const { vitrine, service } = await vitrineReservable()
    const creeLe = plus(maintenant, -SECONDE_MS)
    await remplir(vitrine.id, service.id, creeLe, LIMITE_RESERVATIONS - 1, 'confirmee')
    await remplir(vitrine.id, service.id, creeLe, 2, 'refusee', 20)
    await remplir(vitrine.id, service.id, creeLe, 1, 'annulee', 25)
    const [premier, second] = lundis(maintenant, 2)

    const dixieme = await reserver(vitrine.username, service.slug, premier!, maintenant)
    const onzieme = await rejet(reserver(vitrine.username, service.slug, second!, maintenant))

    expect(dixieme.reservation.statut).toBe('en_attente')
    expect(onzieme).toMatchObject({ code: 'RESERVATIONS_INDISPONIBLES', status: 409 })
  })

  it.each(['en_attente', 'confirmee', 'terminee'] as const)('should count %s bookings in the quota', async (statut) => {
    const maintenant = new Date()
    const { vitrine, service } = await vitrineReservable()
    await remplir(vitrine.id, service.id, plus(maintenant, -SECONDE_MS), LIMITE_RESERVATIONS, statut)

    const erreur = await rejet(reserver(vitrine.username, service.slug, lundis(maintenant, 1)[0]!, maintenant))

    expect(erreur.code).toBe('RESERVATIONS_INDISPONIBLES')
  })

  it('should never limit a payer, even at 25 bookings this month', async () => {
    const maintenant = new Date()
    const { user, vitrine, service } = await vitrineReservable()
    await poserAbonnement(user.id, plus(maintenant, jours(45)))
    await remplir(vitrine.id, service.id, plus(maintenant, -SECONDE_MS), 25)

    const creee = await reserver(vitrine.username, service.slug, lundis(maintenant, 1)[0]!, maintenant)

    expect(creee.reservation.id).toBeTruthy()
  })

  it('should not let one vitrine quota block another vitrine', async () => {
    const maintenant = new Date()
    const pleine = await vitrineReservable()
    const autre = await vitrineReservable()
    await remplir(pleine.vitrine.id, pleine.service.id, plus(maintenant, -SECONDE_MS), LIMITE_RESERVATIONS)

    const creee = await reserver(autre.vitrine.username, autre.service.slug, lundis(maintenant, 1)[0]!, maintenant)

    expect(creee.reservation.id).toBeTruthy()
  })
})

describe('réservations : concurrence (CA84)', () => {
  it('should let exactly one of two simultaneous bookings on two different slots through at 9/10', async () => {
    const maintenant = new Date()
    const { vitrine, service } = await vitrineReservable()
    await remplir(vitrine.id, service.id, plus(maintenant, -SECONDE_MS), LIMITE_RESERVATIONS - 1)
    const [lundi] = lundis(maintenant, 1)

    const resultats = await Promise.allSettled([
      reserver(vitrine.username, service.slug, lundi!, maintenant),
      reserver(vitrine.username, service.slug, plus(lundi!, 30 * 60_000), maintenant),
    ])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refus = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(refus?.reason).toMatchObject({ code: 'RESERVATIONS_INDISPONIBLES', status: 409 })
  })

  it('should never exceed the limit under six simultaneous bookings from an empty month', async () => {
    const maintenant = new Date()
    const { vitrine, service } = await vitrineReservable()
    await remplir(vitrine.id, service.id, plus(maintenant, -SECONDE_MS), LIMITE_RESERVATIONS - 2)
    const [lundi] = lundis(maintenant, 1)

    const resultats = await Promise.allSettled(Array.from({ length: 6 }, (_v, i) => reserver(vitrine.username, service.slug, plus(lundi!, i * 30 * 60_000), maintenant)))

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })
})

describe('créneaux suspendus et demandes (CA85)', () => {
  it('should return no slot and `suspendues: true` once the quota is reached, while quote requests stay possible', async () => {
    const maintenant = new Date()
    const { vitrine, service } = await vitrineReservable()
    await remplir(vitrine.id, service.id, plus(maintenant, -SECONDE_MS), LIMITE_RESERVATIONS)
    const devis = await insertService(vitrine.id, { type: 'devis', dureeMin: null, tarif: 'devis', reservable: true, titre: 'Devis' })
    const { listCreneaux } = await creneauxService()
    const { createDemande } = await demandesService()
    const [lundi] = lundis(maintenant, 1)
    const jour = iso(lundi!).slice(0, 10)

    const suspendu = await listCreneaux({ username: vitrine.username, serviceSlug: service.slug, du: jour, au: jour, maintenant })
    const demande = await createDemande(vitrine.username, { serviceSlug: devis.slug, nom: 'Alice', email: 'alice@exemple.test', telephone: '+237699000003', message: 'Un devis svp.' })

    expect(suspendu.creneaux).toEqual([])
    expect(suspendu.suspendues).toBe(true)
    expect(demande.item.id).toBeTruthy()
  })

  it('should return slots and `suspendues: false` while the quota is not reached', async () => {
    const maintenant = new Date()
    const { vitrine, service } = await vitrineReservable()
    const { listCreneaux } = await creneauxService()
    const jour = iso(lundis(maintenant, 1)[0]!).slice(0, 10)

    const libre = await listCreneaux({ username: vitrine.username, serviceSlug: service.slug, du: jour, au: jour, maintenant })

    expect(libre.suspendues).toBe(false)
    expect(libre.creneaux.length).toBeGreaterThan(0)
  })
})

describe('service masqué : agenda, réservation, demande (CA93)', () => {
  it('should hide the agenda and answer 404 to slots, bookings and requests when the only bookable service is masked by the plan', async () => {
    const maintenant = new Date()
    const { user, vitrine } = await vitrineReservable()
    await viderServices(vitrine.id)
    await ajouterServices(vitrine.id, 3, { reservable: false })
    const masque = await insertService(vitrine.id, { titre: 'Masqué', type: 'rdv', dureeMin: 30, reservable: true, createdAt: new Date('2026-06-01T08:00:00.000Z') })
    const { getPublicVitrinePage } = await vitrinesService()
    const { listCreneaux } = await creneauxService()
    const { createDemande } = await demandesService()
    const jour = iso(lundis(maintenant, 1)[0]!).slice(0, 10)

    const page = await getPublicVitrinePage(vitrine.username)
    const creneaux = await rejet(listCreneaux({ username: vitrine.username, serviceSlug: masque.slug, du: jour, au: jour, maintenant }))
    const reservation = await rejet(reserver(vitrine.username, masque.slug, lundis(maintenant, 1)[0]!, maintenant))
    const devis = await insertService(vitrine.id, { titre: 'Devis masqué', type: 'devis', dureeMin: null, tarif: 'devis', createdAt: new Date('2026-06-02T08:00:00.000Z') })
    const demande = await rejet(createDemande(vitrine.username, { serviceSlug: devis.slug, nom: 'Alice', email: 'alice@exemple.test', telephone: '+237699000003', message: 'Un devis svp.' }))

    expect(page.contenus.agenda).toBe(false)
    expect(creneaux).toMatchObject({ code: 'SERVICE_INTROUVABLE', status: 404 })
    expect(reservation).toMatchObject({ code: 'SERVICE_INTROUVABLE', status: 404 })
    expect(demande).toMatchObject({ status: 404 })
    expect(user.id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------------------------------

const TEXTE = (n: number): string => `Je suis cardiologue à Douala et j’accompagne mes patients avec attention, variante ${n}.`
const ameliorer = async (userId: string, n: number, now: Date = new Date()) => {
  const { ameliorer: fn } = await iaAmeliorer()
  return fn(userId, schemaAmeliorerInput.parse({ champ: 'bio', texte: TEXTE(n) }), now)
}

async function generationsDuMois(userId: string, now: Date, terminees: number, enCours = 0, replis = 0) {
  for (let i = 0; i < terminees; i += 1) await insertGeneration(userId, { type: 'ameliorer_texte', statut: 'terminee', termineeLe: now, createdAt: now, sortie: { texte: 'ok' }, entreeEmpreinte: empreinteDeTest(`t${i}`) })
  for (let i = 0; i < enCours; i += 1) await insertGeneration(userId, { type: 'ameliorer_texte', statut: 'en_cours', createdAt: now, entreeEmpreinte: empreinteDeTest(`c${i}`) })
  for (let i = 0; i < replis; i += 1) await insertGeneration(userId, { type: 'ameliorer_texte', statut: 'repli', motifRepli: 'echec_fournisseur', termineeLe: now, createdAt: now, entreeEmpreinte: empreinteDeTest(`r${i}`) })
}

/** `ameliorer` lit la vitrine du professionnel pour construire l'entrée : il en faut une. */
async function utilisateurAvecVitrine(surcharges: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser(surcharges)
  await insertVitrineRow(user.id, { publiee: true })
  return user
}

describe('quota IA (CA86, CA87)', () => {
  it('should refuse with 403 generations_ia_mois when finished + running generations reach the limit (CA86)', async () => {
    const now = new Date()
    const user = await utilisateurAvecVitrine()
    await generationsDuMois(user.id, now, LIMITE_IA - 1, 1)

    const erreur = await rejet(ameliorer(user.id, 1, now))

    expect(erreur).toMatchObject({ code: 'LIMITE_PLAN_ATTEINTE', status: 403 })
    expect(erreur.data).toMatchObject({ ressource: 'generations_ia_mois', limite: LIMITE_IA, utilise: LIMITE_IA, plan: 'gratuit' })
  })

  it('should not consume the quota with fallbacks : 2 finished + 1 fallback -> still allowed (CA86)', async () => {
    const now = new Date()
    const user = await utilisateurAvecVitrine()
    await generationsDuMois(user.id, now, LIMITE_IA - 1, 0, 1)

    const resultat = await ameliorer(user.id, 1, now)

    expect(('generation' in resultat ? resultat.generation : resultat).id).toBeTruthy()
  })

  it('should not count a generation of the previous month, nor a stale pending one (job lost)', async () => {
    const now = utc('2026-11-15T10:00:00.000Z')
    const user = await utilisateurAvecVitrine()
    await generationsDuMois(user.id, utc('2026-10-20T10:00:00.000Z'), LIMITE_IA)
    await insertGeneration(user.id, { type: 'ameliorer_texte', statut: 'en_attente', createdAt: plus(now, -jours(2)), entreeEmpreinte: empreinteDeTest('perdue') })

    const resultat = await ameliorer(user.id, 1, now)

    expect(('generation' in resultat ? resultat.generation : resultat).id).toBeTruthy()
  })

  it('should start the month at local midnight of the account time zone : Pacific/Kiritimati counts 1 November local from 31 October 10:00Z', async () => {
    const user = await utilisateurAvecVitrine({ fuseau: 'Pacific/Kiritimati' })
    // 2026-10-31T10:30Z = 2026-11-01 00:30 à Kiritimati (UTC+14) : novembre. Générations du 31/10 à 09:00Z = 31/10 23:00 local : octobre.
    await generationsDuMois(user.id, utc('2026-10-31T09:00:00.000Z'), LIMITE_IA)

    const resultat = await ameliorer(user.id, 1, utc('2026-10-31T10:30:00.000Z'))

    expect(('generation' in resultat ? resultat.generation : resultat).id).toBeTruthy()
  })

  it('should create only one of two simultaneous improvement requests with DIFFERENT inputs at limit - 1 (CA87)', async () => {
    const now = new Date()
    const user = await utilisateurAvecVitrine()
    await generationsDuMois(user.id, now, LIMITE_IA - 1)

    const resultats = await Promise.allSettled([ameliorer(user.id, 1, now), ameliorer(user.id, 2, now)])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason).toMatchObject({ code: 'LIMITE_PLAN_ATTEINTE', status: 403 })
    expect((await lireGenerationsDe(user.id)).filter((g) => g.statut === 'en_attente')).toHaveLength(1)
  })

  it('should return the identical existing generation for the same input without consuming quota (deduplication, not a limit error)', async () => {
    const now = new Date()
    const user = await utilisateurAvecVitrine()
    const premiere = await ameliorer(user.id, 1, now)
    await generationsDuMois(user.id, now, LIMITE_IA - 1)

    const rejeu = await ameliorer(user.id, 1, now)

    expect(('generation' in rejeu ? rejeu.generation : rejeu).id).toBe(('generation' in premiere ? premiere.generation : premiere).id)
  })

  it('should never limit a payer', async () => {
    const now = new Date()
    const user = await utilisateurAvecVitrine()
    await poserAbonnement(user.id, plus(now, jours(45)))
    await generationsDuMois(user.id, now, LIMITE_IA + 5)

    const resultat = await ameliorer(user.id, 1, now)

    expect(('generation' in resultat ? resultat.generation : resultat).id).toBeTruthy()
  })

  it('should count generations in getIaQuota the same way (running ones included, fallbacks excluded)', async () => {
    const now = new Date()
    const user = await utilisateurAvecVitrine()
    await generationsDuMois(user.id, now, 1, 1, 1)
    const { getIaQuota } = await import('../../server/services/plans')

    expect(await getIaQuota(user.id, now)).toMatchObject({ plan: 'gratuit', limite: LIMITE_IA, utilisees: 2, restantes: LIMITE_IA - 2, depasse: false })
  })
})

describe('onboarding et quotas (CA88, CA89)', () => {
  it('should produce a `quota_atteint` fallback without calling the provider when the monthly quota is reached (CA88)', async () => {
    const { generer, saveEtape } = await import('../../server/services/onboarding')
    const { schemaOnboardingEtape } = await import('../../shared/schemas/onboarding')
    const { IDENTITE_DEMO } = await import('../unit/support/ia-fixtures')
    const user = await createUser()
    await saveEtape(user.id, schemaOnboardingEtape.parse({ etape: 1, ...IDENTITE_DEMO }))
    await generationsDuMois(user.id, new Date(), LIMITE_IA)

    const resultat = await generer(user.id)

    const generation = 'generation' in resultat ? resultat.generation : resultat
    expect(await lireGeneration(generation.id)).toMatchObject({ statut: 'repli', motifRepli: 'quota_atteint' })
  })
})
