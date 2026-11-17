import { beforeEach, describe, expect, it } from 'vitest'
import { journalDe, lireJournal, ouvrirAdmin, preparerSuiteAdmin, compterJournal } from '../support/admin'
import {
  CLE_A,
  CLE_B,
  MOTIF_A2,
  appelerA2,
  codeReauthPour,
  compterEmailsOutbox,
  creerCompteSimple,
  lireAbonnementDe,
  lireOutboxUtilisateur,
} from '../support/admin-a2'
import { insererPaiement, lirePaiement, poserAbonnement } from '../support/abonnements'
import type { OptionsA2 } from '../support/admin-a2'
import { ERROR_STATUS } from '../../../shared/erreurs'

// A2 CA06, CA07, D-A2-04, D-A2-05, D-A2-06 : offrir des jours et changer le plan, sur PostgreSQL réel. L'horloge de la
// route est celle du système : les instants « maintenant + N jours » sont vérifiés dans une fenêtre bornée par deux
// lectures de l'horloge autour de l'appel ; les instants construits à partir d'une échéance existante sont EXACTS.

const suite = preparerSuiteAdmin()
const JOUR_MS = 86_400_000
const TOLERANCE_MS = 10_000
let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string

beforeEach(async () => {
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
})

const offrir = (id: string, jours: number, options: OptionsA2 = {}) =>
  appelerA2('offrirJours', { id, cookie, cleIdempotence: CLE_A, corps: { motif: MOTIF_A2, jours }, ...options })

async function changer(id: string, corps: Record<string, unknown>, options: { cle?: string | null, reauth?: string | null } = {}) {
  const reauth = options.reauth === null ? undefined : (options.reauth ?? await codeReauthPour(admin.id, 'changerPlan', id))
  return appelerA2('changerPlan', {
    id,
    cookie,
    corps: { motif: MOTIF_A2, ...corps },
    ...(options.cle === null ? {} : { cleIdempotence: options.cle ?? CLE_A }),
    ...(reauth === undefined ? {} : { reauth }),
  })
}

/** Fenêtre [avant, après] de l'horloge autour d'un appel, pour borner « maintenant + N jours ». */
async function mesure<T>(appel: () => Promise<T>): Promise<{ resultat: T, avant: number, apres: number }> {
  const avant = Date.now()
  const resultat = await appel()
  return { resultat, avant, apres: Date.now() }
}

describe('offrir des jours : compte avec échéance (CA06, D-A2-04)', () => {
  it('should set expire_le to EXACTLY T + 30 days, keep the origin, and journal the change', async () => {
    const { user } = await creerCompteSimple()
    const T = new Date(Date.now() + 10 * JOUR_MS)
    const ligne = await poserAbonnement(user.id, T)

    const reponse = await offrir(user.id, 30)

    const attendu = new Date(T.getTime() + 30 * JOUR_MS)
    expect(reponse).toMatchObject({ status: 200, corps: { expireLe: attendu.toISOString(), rejoue: false } })
    const apres = await lireAbonnementDe(user.id)
    expect(apres?.expireLe.getTime()).toBe(attendu.getTime())
    expect(apres).toMatchObject({ id: ligne.id, origine: 'paiement', plan: 'payant' })
    const [journal] = await journalDe('utilisateur.offrir_jours')
    expect(journal).toMatchObject({ admin_id: admin.id, cible_type: 'utilisateur', cible_id: user.id, motif: MOTIF_A2, cle_idempotence: CLE_A })
    expect(journal?.avant).toMatchObject({ expire_le: T.toISOString(), origine: 'paiement' })
    expect(journal?.apres).toMatchObject({ expire_le: attendu.toISOString() })
  })

  it('should start from now (not from the past) when the subscription already ended', async () => {
    const { user } = await creerCompteSimple()
    await poserAbonnement(user.id, new Date(Date.now() - 5 * JOUR_MS))

    const { avant, apres } = await mesure(() => offrir(user.id, 30))

    const expire = (await lireAbonnementDe(user.id))!.expireLe.getTime()
    expect(expire).toBeGreaterThanOrEqual(avant + 30 * JOUR_MS)
    expect(expire).toBeLessThanOrEqual(apres + 30 * JOUR_MS)
  })

  it('should be an exact N × 24 h even across a long period (Africa/Douala has no daylight saving, no rounding to midnight)', async () => {
    const { user } = await creerCompteSimple()
    const T = new Date('2099-03-29T13:17:41.123Z')
    await poserAbonnement(user.id, T, { premiereActivationLe: new Date('2099-01-01T00:00:00.000Z') })

    await offrir(user.id, 365)

    expect((await lireAbonnementDe(user.id))!.expireLe.toISOString()).toBe(new Date(T.getTime() + 365 * JOUR_MS).toISOString())
  })

  it('should send ONE utilisateur_jours_offerts e-mail to the owner, atomically with the change', async () => {
    const { user } = await creerCompteSimple()
    await poserAbonnement(user.id, new Date(Date.now() + 10 * JOUR_MS))

    await offrir(user.id, 7)

    const [ligne] = await lireOutboxUtilisateur(user.id, 'utilisateur_jours_offerts')
    const [journal] = await journalDe('utilisateur.offrir_jours')
    expect(await lireOutboxUtilisateur(user.id)).toHaveLength(1)
    expect(ligne).toMatchObject({ entiteType: 'utilisateur', statut: 'en_attente', occurrence: String(journal?.numero) })
  })

  it('should need no reauthentication (motif only) and answer 404 UTILISATEUR_INTROUVABLE for an unknown account', async () => {
    const inconnu = await offrir('00000000-0000-4000-8000-000000000000', 5)

    expect(inconnu).toMatchObject({ status: 404, code: 'UTILISATEUR_INTROUVABLE' })
    expect(await compterJournal()).toBe(0)
  })
})

describe('offrir des jours : compte gratuit (CA07)', () => {
  it('should create an abonnements row origine=offert, plan=payant, expire_le = now + 30 days, and make the plan paid', async () => {
    const { user } = await creerCompteSimple()
    expect(await lireAbonnementDe(user.id)).toBeUndefined()

    const { avant, apres } = await mesure(() => offrir(user.id, 30))

    const ligne = await lireAbonnementDe(user.id)
    expect(ligne).toMatchObject({ plan: 'payant', origine: 'offert' })
    expect(ligne!.expireLe.getTime()).toBeGreaterThanOrEqual(avant + 30 * JOUR_MS)
    expect(ligne!.expireLe.getTime()).toBeLessThanOrEqual(apres + 30 * JOUR_MS)
    expect(Math.abs(ligne!.premiereActivationLe.getTime() - avant)).toBeLessThan(TOLERANCE_MS)
    expect(ligne!.premiereActivationLe.getTime()).toBeLessThan(ligne!.expireLe.getTime())
    const { getPlanEffectif } = await import('../../../server/services/plans')
    expect((await getPlanEffectif(user.id)).plan).toBe('payant')
  })

  it('should serialise two concurrent offers on a free account: ONE row, 60 days in total, no unique violation', async () => {
    const { user } = await creerCompteSimple()

    const { avant, apres, resultat } = await mesure(() => Promise.all([offrir(user.id, 30, { cleIdempotence: CLE_A }), offrir(user.id, 30, { cleIdempotence: CLE_B })]))

    expect(resultat.map((r) => r.status)).toEqual([200, 200])
    const ligne = await lireAbonnementDe(user.id)
    expect(ligne!.expireLe.getTime()).toBeGreaterThanOrEqual(avant + 60 * JOUR_MS)
    expect(ligne!.expireLe.getTime()).toBeLessThanOrEqual(apres + 60 * JOUR_MS)
    expect(await journalDe('utilisateur.offrir_jours')).toHaveLength(2)
  })
})

describe('offrir des jours : bornes et validation', () => {
  it.each([1, 365])('should accept %i day(s)', async (jours) => {
    const { user } = await creerCompteSimple()

    expect((await offrir(user.id, jours)).status).toBe(200)
  })

  it.each([
    ['zero', 0],
    ['366', 366],
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '30'],
    ['null', null],
    ['Infinity as text', 'Infinity'],
  ])('should answer 422 and write nothing for jours = %s', async (_cas, jours) => {
    const { user } = await creerCompteSimple()

    const reponse = await appelerA2('offrirJours', { id: user.id, cookie, cleIdempotence: CLE_A, corps: { motif: MOTIF_A2, jours } })

    expect(reponse.status).toBe(422)
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
    expect(await compterJournal()).toBe(0)
  })

  it('should answer 422 for a missing jours, an unknown key and a short motif', async () => {
    const { user } = await creerCompteSimple()

    for (const corps of [{ motif: MOTIF_A2 }, { motif: MOTIF_A2, jours: 5, offert: true }, { motif: 'abc', jours: 5 }]) {
      expect((await appelerA2('offrirJours', { id: user.id, cookie, cleIdempotence: CLE_A, corps })).status).toBe(422)
    }
    expect(await compterJournal()).toBe(0)
  })
})

describe('offrir des jours : idempotence (D-A2-06, CA06)', () => {
  it('should return the recorded result on a replay with the same key and body: expire_le unchanged, no second journal line, no second e-mail', async () => {
    const { user } = await creerCompteSimple()
    const T = new Date(Date.now() + 10 * JOUR_MS)
    await poserAbonnement(user.id, T)
    const premiere = await offrir(user.id, 30)
    const apresPremiere = (await lireAbonnementDe(user.id))!.expireLe.getTime()

    const rejeu = await offrir(user.id, 30)

    expect(rejeu.status).toBe(200)
    expect(rejeu.corps).toMatchObject({ expireLe: (premiere.corps as { expireLe: string }).expireLe, rejoue: true })
    expect((await lireAbonnementDe(user.id))!.expireLe.getTime()).toBe(apresPremiere)
    expect(await journalDe('utilisateur.offrir_jours')).toHaveLength(1)
    expect(await lireOutboxUtilisateur(user.id, 'utilisateur_jours_offerts')).toHaveLength(1)
  })

  it('should answer 409 IDEMPOTENCE_CONFLIT for the same key with a DIFFERENT body, and apply nothing', async () => {
    const { user } = await creerCompteSimple()
    await poserAbonnement(user.id, new Date(Date.now() + 10 * JOUR_MS))
    await offrir(user.id, 30)
    const apresPremiere = (await lireAbonnementDe(user.id))!.expireLe.getTime()

    const conflit = await offrir(user.id, 31)

    expect(conflit).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
    expect((await lireAbonnementDe(user.id))!.expireLe.getTime()).toBe(apresPremiere)
    expect(await journalDe('utilisateur.offrir_jours')).toHaveLength(1)
  })

  it('should treat a different motif with the same key and jours as a different body (409)', async () => {
    const { user } = await creerCompteSimple()
    await offrir(user.id, 30)

    const conflit = await appelerA2('offrirJours', { id: user.id, cookie, cleIdempotence: CLE_A, corps: { motif: 'Un autre motif valable', jours: 30 } })

    expect(conflit).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
  })

  it('should not replay the answer of ANOTHER account: the same key on another target is a conflict, never a leak of the first result', async () => {
    const a = await creerCompteSimple()
    const b = await creerCompteSimple()
    await offrir(a.user.id, 30)

    const surB = await offrir(b.user.id, 30)

    expect(surB.status).toBe(409)
    expect(surB.code).toBe('IDEMPOTENCE_CONFLIT')
    expect(await lireAbonnementDe(b.user.id)).toBeUndefined()
  })

  it('should apply ONE effect when the same request arrives twice at once (30 days, not 60)', async () => {
    const { user } = await creerCompteSimple()
    const T = new Date(Date.now() + 10 * JOUR_MS)
    await poserAbonnement(user.id, T)

    const reponses = await Promise.all([offrir(user.id, 30), offrir(user.id, 30)])

    for (const reponse of reponses) expect([200, 409]).toContain(reponse.status)
    expect((await lireAbonnementDe(user.id))!.expireLe.getTime()).toBe(T.getTime() + 30 * JOUR_MS)
    expect(await journalDe('utilisateur.offrir_jours')).toHaveLength(1)
  })

  it('should keep keys independent between administrators', async () => {
    const { user } = await creerCompteSimple()
    const T = new Date(Date.now() + 10 * JOUR_MS)
    await poserAbonnement(user.id, T)
    await offrir(user.id, 30)

    const { admin: second, cookie: cookieSecond } = await ouvrirAdmin(suite.auth())
    expect(second.id).not.toBe(admin.id)
    const reponse = await offrir(user.id, 5, { cookie: cookieSecond })

    expect(reponse).toMatchObject({ status: 200, corps: { rejoue: false } })
    expect((await lireAbonnementDe(user.id))!.expireLe.getTime()).toBe(T.getTime() + 35 * JOUR_MS)
  })

  it('should not record the key when the action failed: a retry with the same key then applies for real', async () => {
    const { user } = await creerCompteSimple()
    const { avecJournalEnPanne } = await import('../support/admin')

    const echec = await avecJournalEnPanne(() => offrir(user.id, 30))
    expect(echec.status).toBe(500)
    expect(await lireAbonnementDe(user.id)).toBeUndefined()

    const reprise = await offrir(user.id, 30)

    expect(reprise).toMatchObject({ status: 200, corps: { rejoue: false } })
    expect(await lireAbonnementDe(user.id)).toMatchObject({ origine: 'offert' })
  })

  it.each([
    ['missing', null, 422, 'CLE_IDEMPOTENCE_REQUISE'],
    ['too short (7 characters)', 'abcdefg', 422, undefined],
    ['too long (129 characters)', 'a'.repeat(129), 422, undefined],
    ['with spaces', 'une cle avec espaces', 422, undefined],
    ['with a semicolon and a colon-space injection attempt', 'cle-valable;X-Injecte: 1', 422, undefined],
  ])('should answer 422 for a key that is %s, and write nothing', async (_cas, cle, statut, code) => {
    const { user } = await creerCompteSimple()

    const reponse = await appelerA2('offrirJours', {
      id: user.id,
      cookie,
      ...(cle === null ? {} : { cleIdempotence: cle }),
      corps: { motif: MOTIF_A2, jours: 5 },
    })

    expect(reponse.status).toBe(statut)
    if (code !== undefined) expect(reponse.code).toBe(code)
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
    expect(await compterJournal()).toBe(0)
  })

  it('should accept a key of exactly 8 and 128 characters', async () => {
    const a = await creerCompteSimple()
    const b = await creerCompteSimple()

    expect((await offrir(a.user.id, 1, { cleIdempotence: 'abcd1234' })).status).toBe(200)
    expect((await offrir(b.user.id, 1, { cleIdempotence: 'k'.repeat(128) })).status).toBe(200)
  })
})

describe('changer le plan (D-A2-05, D-A2-07)', () => {
  it('should delete the subscription row when moving payant -> gratuit, keep the payments, and journal {plan}', async () => {
    const { user } = await creerCompteSimple()
    const paiement = await insererPaiement(user.id)
    await poserAbonnement(user.id, new Date(Date.now() + 20 * JOUR_MS))

    const reponse = await changer(user.id, { plan: 'gratuit' })

    expect(reponse).toMatchObject({ status: 200, corps: { plan: 'gratuit', expireLe: null, rejoue: false } })
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
    expect((await lirePaiement(paiement.id)).userId).toBe(user.id)
    const [journal] = await journalDe('utilisateur.changer_plan')
    expect(journal).toMatchObject({ cible_type: 'utilisateur', cible_id: user.id, avant: { plan: 'payant' }, apres: { plan: 'gratuit' }, cle_idempotence: CLE_A })
    const { getPlanEffectif } = await import('../../../server/services/plans')
    expect((await getPlanEffectif(user.id)).plan).toBe('gratuit')
  })

  it('should create the row origine=admin for N days when moving gratuit -> payant', async () => {
    const { user } = await creerCompteSimple()

    const { avant, apres, resultat } = await mesure(() => changer(user.id, { plan: 'payant', jours: 30 }))

    expect(resultat).toMatchObject({ status: 200, corps: { plan: 'payant', rejoue: false } })
    const ligne = await lireAbonnementDe(user.id)
    expect(ligne).toMatchObject({ plan: 'payant', origine: 'admin' })
    expect(ligne!.expireLe.getTime()).toBeGreaterThanOrEqual(avant + 30 * JOUR_MS)
    expect(ligne!.expireLe.getTime()).toBeLessThanOrEqual(apres + 30 * JOUR_MS)
    const [journal] = await journalDe('utilisateur.changer_plan')
    expect(journal).toMatchObject({ avant: { plan: 'gratuit' }, apres: { plan: 'payant' } })
  })

  it('should require jours for payant (422) and refuse jours for gratuit (422)', async () => {
    const { user } = await creerCompteSimple()

    expect((await changer(user.id, { plan: 'payant' })).status).toBe(422)
    expect((await changer(user.id, { plan: 'gratuit', jours: 30 })).status).toBe(422)
    expect((await changer(user.id, { plan: 'payant', jours: 366 })).status).toBe(422)
    expect((await changer(user.id, { plan: 'intermediaire', jours: 30 })).status).toBe(422)
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
    expect(await compterJournal()).toBe(0)
  })

  it('should NEVER shorten the expiry of an account that paid: payant on an already paid account keeps expire_le >= its current value', async () => {
    const { user } = await creerCompteSimple()
    const T = new Date(Date.now() + 300 * JOUR_MS)
    await poserAbonnement(user.id, T)

    const reponse = await changer(user.id, { plan: 'payant', jours: 1 })

    expect([200, 409, 422]).toContain(reponse.status)
    expect((await lireAbonnementDe(user.id))!.expireLe.getTime()).toBeGreaterThanOrEqual(T.getTime())
  })

  it('should not fail with a server error when moving a free account to gratuit', async () => {
    const { user } = await creerCompteSimple()

    const reponse = await changer(user.id, { plan: 'gratuit' })

    expect(reponse.status).toBeLessThan(500)
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
  })

  it('should demand the reauthentication code (REAUTH_REQUISE) and the Idempotency-Key, with no effect otherwise', async () => {
    const { user } = await creerCompteSimple()
    await poserAbonnement(user.id, new Date(Date.now() + 20 * JOUR_MS))

    const sansCode = await changer(user.id, { plan: 'gratuit' }, { reauth: null })
    const sansCle = await changer(user.id, { plan: 'gratuit' }, { cle: null })

    expect(sansCode).toMatchObject({ status: ERROR_STATUS.REAUTH_REQUISE, code: 'REAUTH_REQUISE' })
    expect(sansCle.status).toBe(422)
    expect(await lireAbonnementDe(user.id)).toBeDefined()
    expect(await compterJournal()).toBe(0)
  })

  it('should replay (same key, same body) without effect, and answer 409 IDEMPOTENCE_CONFLIT for another body', async () => {
    const { user } = await creerCompteSimple()

    const premiere = await changer(user.id, { plan: 'payant', jours: 30 })
    const expire = (await lireAbonnementDe(user.id))!.expireLe.getTime()
    const rejeu = await changer(user.id, { plan: 'payant', jours: 30 })
    const conflit = await changer(user.id, { plan: 'payant', jours: 60 })

    expect(premiere.status).toBe(200)
    expect(rejeu).toMatchObject({ status: 200, corps: { rejoue: true } })
    expect(conflit).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
    expect((await lireAbonnementDe(user.id))!.expireLe.getTime()).toBe(expire)
    expect(await journalDe('utilisateur.changer_plan')).toHaveLength(1)
  })

  it('should answer 404 for an unknown account and write nothing', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000'

    const reponse = await changer(inconnu, { plan: 'gratuit' })

    expect(reponse).toMatchObject({ status: 404, code: 'UTILISATEUR_INTROUVABLE' })
    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
  })

  it('should keep the journal free of any personal data over the whole subscription scenario', async () => {
    const { user } = await creerCompteSimple()
    await offrir(user.id, 30)
    await changer(user.id, { plan: 'gratuit' })

    const brut = JSON.stringify((await lireJournal()).map((l) => [l.avant, l.apres, l.cible_id]))

    expect(brut).not.toContain(user.email)
    expect(brut).not.toContain(user.name)
  })
})
