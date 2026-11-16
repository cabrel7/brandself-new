import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_RAPPEL_INTERVALLE_HEURES } from '../../../shared/limites'
import { schemaListeAbonnementsDto, schemaRappelAbonnementReponse } from '../../../shared/schemas/admin-paiements'
import { db } from '../../../server/utils/db'
import { minuitLocalSuivant } from '../../../server/services/abonnements-regles'
import { jours, lireAbonnement, minutes, plus, poserAbonnement } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { lireOutbox, RecordingTransport } from '../support/notifications'
import { traiter } from '../support/planification'
import {
  appelerAdmin,
  desinstallerAdmin,
  installerAdmin,
  insererEncaissement,
  journalDe,
  MOTIF,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 CA06 (onglets, via la route, abonnements posés à des dates RELATIVES à l'horloge réelle ; les bornes exactes sont
// prouvées en unitaire, `now` injecté) et CA11 (rappel manuel : limite de 24 h sous verrou, abonnement échu refusé, une seule
// ligne d'outbox sous concurrence, e-mail réellement partant). Base, journal, outbox et Better Auth RÉELS.

/**
 * Préfixe RÉEL d'une occurrence de rappel manuel. La spec et `shared/admin-paiements.ts` disent `manuel:`, mais
 * `emails_transactionnels_occurrence_check` n'accepte que `[0-9A-Z:.-]` (31 caractères au plus 32) : `manuel:` est refusé
 * par la base. Seule la forme en MAJUSCULES peut exister (défaut de la spec signalé dans le rapport).
 */
const PREFIXE_MANUEL = 'MANUEL:'

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const liste = (onglet: string, requete = '') =>
  appelerAdmin(ROUTES.abonnements, connecte, { chemin: `/api/admin/abonnements?onglet=${onglet}${requete}` })

async function abonne(expireLe: Date, options: { email?: string, devise?: string } = {}) {
  const user = await createUser({ ...(options.email === undefined ? {} : { email: options.email }), ...(options.devise === undefined ? {} : { devise: options.devise }) })
  const abonnement = await poserAbonnement(user.id, expireLe)
  return { user, abonnement }
}

const ids = (corps: unknown): string[] => schemaListeAbonnementsDto.parse(corps).elements.map((e) => e.id)

describe('onglets des abonnements (CA06, D-A3-14)', () => {
  it('should put now+3d in renewal, now-2d in grace, now-20d in expired, and now-40d and now+30d nowhere', async () => {
    const maintenant = new Date()
    const renouvellement = await abonne(plus(maintenant, jours(3)))
    const grace = await abonne(plus(maintenant, -jours(2)))
    const expire = await abonne(plus(maintenant, -jours(20)))
    const tropVieux = await abonne(plus(maintenant, -jours(40)))
    const loin = await abonne(plus(maintenant, jours(30)))

    const resultats = {
      renouvellement: await liste('renouvellement'),
      grace: await liste('grace'),
      expires: await liste('expires'),
    }

    for (const reponse of Object.values(resultats)) expect(reponse.status).toBe(200)
    expect(ids(resultats.renouvellement.corps)).toEqual([renouvellement.abonnement.id])
    expect(ids(resultats.grace.corps)).toEqual([grace.abonnement.id])
    expect(ids(resultats.expires.corps)).toEqual([expire.abonnement.id])
    const tous = Object.values(resultats).flatMap((r) => ids(r.corps))
    expect(tous).not.toContain(tropVieux.abonnement.id)
    expect(tous).not.toContain(loin.abonnement.id)
  })

  it('should describe each row with the holder e-mail, plan, state, origin, expiry and the last payment, nothing else', async () => {
    const maintenant = new Date()
    const { user, abonnement } = await abonne(plus(maintenant, jours(3)), { email: 'titulaire@exemple.test', devise: 'EUR' })
    const paiement = await insererEncaissement(user.id, plus(maintenant, -jours(27)), { devise: 'EUR', montantPlan: 1500, montant: 1500 })
    await db.execute(sql`UPDATE abonnements SET dernier_paiement_id = ${paiement.id}, origine = 'offert' WHERE id = ${abonnement.id}`)

    const reponse = await liste('renouvellement')

    const [ligne] = schemaListeAbonnementsDto.parse(reponse.corps).elements
    expect(ligne).toEqual({
      id: abonnement.id,
      utilisateur: { id: user.id, email: 'titulaire@exemple.test' },
      plan: 'payant',
      devise: 'EUR',
      expireLe: abonnement.expireLe.toISOString(),
      etat: 'actif',
      origine: 'offert',
      dernierPaiement: { id: paiement.id, statut: 'reussi', montant: 1500, devise: 'EUR', creeLe: paiement.createdAt.toISOString() },
    })
  })

  it('should report the grace state for an expired-since-2-days subscription and null when there is no payment yet', async () => {
    const { abonnement } = await abonne(plus(new Date(), -jours(2)))

    const [ligne] = schemaListeAbonnementsDto.parse((await liste('grace')).corps).elements

    expect(ligne).toMatchObject({ id: abonnement.id, etat: 'grace', dernierPaiement: null, origine: 'paiement' })
  })

  it('should paginate: 30 renewals give 25 then 5 rows, all distinct, with the same total', async () => {
    for (let i = 0; i < 30; i += 1) await abonne(plus(new Date(), jours(1) + minutes(i)))

    const page1 = schemaListeAbonnementsDto.parse((await liste('renouvellement')).corps)
    const page2 = schemaListeAbonnementsDto.parse((await liste('renouvellement', '&page=2')).corps)

    expect(page1).toMatchObject({ onglet: 'renouvellement', total: 30, page: 1, limite: 25 })
    expect(page1.elements).toHaveLength(25)
    expect(page2).toMatchObject({ total: 30, page: 2 })
    expect(page2.elements).toHaveLength(5)
    expect(new Set([...page1.elements, ...page2.elements].map((e) => e.id)).size).toBe(30)
  })

  it('should answer an empty list, not an error, when an onglet has no subscription', async () => {
    const reponse = await liste('expires')

    expect(reponse.status).toBe(200)
    expect(schemaListeAbonnementsDto.parse(reponse.corps)).toMatchObject({ elements: [], total: 0 })
  })

  it.each(['', '?onglet=', '?onglet=tous', '?onglet=GRACE'])('should refuse the missing or unknown onglet (query %j)', async (requete) => {
    const reponse = await appelerAdmin(ROUTES.abonnements, connecte, { chemin: `/api/admin/abonnements${requete}` })

    expect([400, 422]).toContain(reponse.status)
  })

  it.each(['page=0', 'page=-1', 'limite=101', 'inconnu=1'])('should refuse the query parameter %s', async (parametre) => {
    const reponse = await liste('grace', `&${parametre}`)

    expect([400, 422]).toContain(reponse.status)
  })
})

describe('rappel manuel : succès et limite de 24 heures (CA11, D-A3-07)', () => {
  const rappeler = (id: string, corps: Record<string, unknown> = { motif: MOTIF }) =>
    appelerAdmin(ROUTES.abonnementRappel, connecte, { chemin: `/api/admin/abonnements/${id}/rappel`, methode: 'POST', params: { id }, corps })
  const lignesManuelles = async (entiteId?: string) =>
    (await lireOutbox({ type: 'abonnement_rappel', ...(entiteId === undefined ? {} : { entiteId }) })).filter((l) => l.occurrence.startsWith(PREFIXE_MANUEL))

  it('should answer 202 { planifie: true } and queue ONE transactional reminder with a manual occurrence, journalled', async () => {
    const { user, abonnement } = await abonne(plus(new Date(), jours(10)))
    const avant = Date.now()

    const reponse = await rappeler(abonnement.id)

    expect(reponse.status).toBe(202)
    expect(schemaRappelAbonnementReponse.parse(reponse.corps)).toEqual({ planifie: true })
    const lignes = await lignesManuelles(abonnement.id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ type: 'abonnement_rappel', entiteType: 'abonnement', entiteId: abonnement.id, categorie: 'transactionnel', statut: 'en_attente', tentatives: 0 })
    const instant = new Date(lignes[0]?.occurrence.slice(PREFIXE_MANUEL.length) ?? '')
    expect(instant.toISOString()).toBe(lignes[0]?.occurrence.slice(PREFIXE_MANUEL.length))
    expect(Math.abs(instant.getTime() - avant)).toBeLessThan(60_000)

    const journal = await journalDe('abonnement.rappeler')
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'abonnement', cible_id: abonnement.id, motif: MOTIF })
    expect(JSON.stringify(journal[0])).not.toContain(user.email)
  })

  it('should answer 409 RAPPEL_RECENT for a second reminder within 24 hours: still one row, one journal line', async () => {
    const { abonnement } = await abonne(plus(new Date(), jours(10)))
    await rappeler(abonnement.id)

    const seconde = await rappeler(abonnement.id)

    expect(seconde).toMatchObject({ status: 409, code: 'RAPPEL_RECENT' })
    expect(await lignesManuelles(abonnement.id)).toHaveLength(1)
    expect(await journalDe('abonnement.rappeler')).toHaveLength(1)
  })

  it('should queue exactly ONE row when two or three requests arrive at the same time (limit checked under a lock)', async () => {
    const { abonnement } = await abonne(plus(new Date(), jours(10)))

    const reponses = await Promise.all([rappeler(abonnement.id), rappeler(abonnement.id), rappeler(abonnement.id)])

    expect(reponses.map((r) => r.status).sort()).toEqual([202, 409, 409])
    for (const refus of reponses.filter((r) => r.status === 409)) expect(refus.code).toBe('RAPPEL_RECENT')
    expect(await lignesManuelles(abonnement.id)).toHaveLength(1)
    expect(await journalDe('abonnement.rappeler')).toHaveLength(1)
  })

  it(`should allow a new reminder ${ADMIN_RAPPEL_INTERVALLE_HEURES} hours later but not before`, async () => {
    const { abonnement } = await abonne(plus(new Date(), jours(10)))
    await rappeler(abonnement.id)
    const vieillir = (heures: number) => db.execute(sql`UPDATE emails_transactionnels SET created_at = created_at - make_interval(hours => ${heures}) WHERE entite_id = ${abonnement.id}`)

    await vieillir(ADMIN_RAPPEL_INTERVALLE_HEURES - 1)
    expect((await rappeler(abonnement.id)).code).toBe('RAPPEL_RECENT')
    await vieillir(2)
    const apres = await rappeler(abonnement.id)

    expect(apres.status).toBe(202)
    expect(await lignesManuelles(abonnement.id)).toHaveLength(2)
  })

  it('should limit PER subscription: a reminder for another subscription is not blocked', async () => {
    const un = await abonne(plus(new Date(), jours(10)))
    const deux = await abonne(plus(new Date(), jours(10)))
    await rappeler(un.abonnement.id)

    const reponse = await rappeler(deux.abonnement.id)

    expect(reponse.status).toBe(202)
  })

  it('should not count the automatic J7/J3/J0 reminders against the manual limit', async () => {
    const { abonnement } = await abonne(plus(new Date(), jours(10)))
    await db.execute(sql`
      INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence, categorie, statut, prochaine_tentative, envoye_le)
      VALUES (gen_random_uuid()::text, 'abonnement_rappel', 'abonnement', ${abonnement.id}, ${`J7:${abonnement.expireLe.toISOString()}`}, 'transactionnel', 'envoye', NULL, now())`)

    const reponse = await rappeler(abonnement.id)

    expect(reponse.status).toBe(202)
  })

  it.each([
    ['échu depuis une seconde', -1_000],
    ['en grâce (échu depuis 2 jours)', -jours(2)],
    ['expiré depuis 40 jours', -jours(40)],
  ])('should answer 409 ABONNEMENT_ECHU for a subscription %s: nothing queued, nothing journalled', async (_titre, decalage) => {
    const { abonnement } = await abonne(plus(new Date(), decalage))

    const reponse = await rappeler(abonnement.id)

    expect(reponse).toMatchObject({ status: 409, code: 'ABONNEMENT_ECHU' })
    expect(await lignesManuelles(abonnement.id)).toHaveLength(0)
    expect(await journalDe('abonnement.rappeler')).toHaveLength(0)
  })

  it('should answer 404 ABONNEMENT_INTROUVABLE for an unknown subscription', async () => {
    const reponse = await rappeler('3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10')

    expect(reponse).toMatchObject({ status: 404, code: 'ABONNEMENT_INTROUVABLE' })
  })

  it.each([
    ['sans motif', {}],
    ['motif trop court', { motif: 'abc' }],
    ['clé inconnue (la clé d\'idempotence n\'existe pas pour un rappel)', { motif: MOTIF, cleIdempotence: 'cle-valide-0001' }],
  ])('should refuse a body %s and queue nothing', async (_titre, corps) => {
    const { abonnement } = await abonne(plus(new Date(), jours(10)))

    const reponse = await rappeler(abonnement.id, corps)

    expect([400, 422]).toContain(reponse.status)
    expect(await lignesManuelles(abonnement.id)).toHaveLength(0)
  })
})

describe('rappel manuel : l\'e-mail part réellement, avec les jours restants calculés à l\'envoi (D-A3-07)', () => {
  const rappeler = (id: string) =>
    appelerAdmin(ROUTES.abonnementRappel, connecte, { chemin: `/api/admin/abonnements/${id}/rappel`, methode: 'POST', params: { id }, corps: { motif: MOTIF } })

  /** Échéance alignée sur un minuit local, dernier jour payé = aujourd'hui + 4 jours (donc « dans 5 jours » à l'heure de l'envoi). */
  const dansCinqJours = (): Date => minuitLocalSuivant(plus(new Date(), jours(5)), 'Africa/Douala')

  it('should send the reminder (not cancelled as renewed or stale) and say how many days remain at the time of sending', async () => {
    const { abonnement } = await abonne(dansCinqJours(), { email: 'pro-rappel@exemple.test' })
    await rappeler(abonnement.id)
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel', entiteId: abonnement.id })

    const { ligne: apres, transport } = await traiter(ligne?.id ?? '', plus(new Date(), minutes(1)), new RecordingTransport())

    expect(apres.statut).toBe('envoye')
    expect(transport.sends).toHaveLength(1)
    expect(transport.dernier.subject).toMatch(/5 jours/)
    expect(transport.dernier.to).toBe('pro-rappel@exemple.test')
  })

  it('should cancel the queued reminder, sending nothing, when the subscription expired before the e-mail went out', async () => {
    const { abonnement } = await abonne(plus(new Date(), jours(2)))
    await rappeler(abonnement.id)
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel', entiteId: abonnement.id })

    const { ligne: apres, transport } = await traiter(ligne?.id ?? '', plus(new Date(), jours(3)), new RecordingTransport())

    expect(apres.statut).toBe('annule')
    expect(transport.sends).toHaveLength(0)
  })

  it('should not touch the subscription itself (a reminder never extends nor changes anything)', async () => {
    const { user, abonnement } = await abonne(dansCinqJours())
    await rappeler(abonnement.id)

    expect(await lireAbonnement(user.id)).toEqual(abonnement)
  })
})
