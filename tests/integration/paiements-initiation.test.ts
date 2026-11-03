import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { paiements } from '../../shared/db/schema'
import { PAIEMENT_RELANCE_APRES_S } from '../../shared/paiements'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import {
  KPAY_TEST_CLE_API,
  KPAY_TEST_CLE_SECRETE,
  KPAY_TEST_SECRET_WEBHOOK,
  corpsWebhook,
} from '../support/faux-kpay'
import {
  initier,
  lireAbonnement,
  lirePaiement,
  lirePaiementsDe,
  MASQUE_ATTENDU,
  minutes,
  moduleAbonnements,
  NUMERO_INTERNATIONAL,
  NUMERO_NATIONAL,
  ouLeNumeroApparait,
  plus,
  providerKpay,
  recevoir,
  saturerBudgetKpay,
  SECONDE_MS,
} from './support/abonnements'
import { rejet } from './support/erreurs'
import { createUser } from './support/fabriques'
import { fauxKpay } from './support/env-kpay'
import { espionnerJournaux } from './support/planification'
import type { EspionJournaux } from './support/planification'

// S10 §6 CA12, CA27 à CA37, CA98 : initiation d'un paiement Mobile Money. VRAIE base, VRAI Redis (limiteurs, budget),
// VRAI adaptateur K-PAY ; seul K-PAY est factice (faux serveur local). Le service est appelé avec une horloge injectée.

let journaux: EspionJournaux | undefined

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

describe('initiation réussie (CA27, CA28)', () => {
  it('should create an `en_attente` payment with the plan price, a masked number and the provider identifiers (CA27)', async () => {
    const user = await createUser()
    const maintenant = new Date()

    const paiement = await initier(user.id, {}, maintenant)

    expect(paiement).toMatchObject({ statut: 'en_attente', montant: 48000, montantPlan: 48000, periodeMois: 12, devise: 'XAF', telephoneMasque: MASQUE_ATTENDU })
    const ligne = await lirePaiement(paiement.id)
    expect(ligne).toMatchObject({
      userId: user.id,
      fournisseur: 'kpay',
      methode: 'mobile_money',
      operateur: 'MTN_MOMO_CMR',
      environnement: 'test',
      plan: 'payant',
      fraisTauxPb: 500,
      fraisSupporteur: 'marchand',
      fraisEstimes: 2400,
      netEstime: 45600,
      initiationIncertaine: false,
      verifications: 0,
      appliqueLe: null,
      termineLe: null,
    })
    expect(ligne.idFournisseur).toBe(fauxKpay.derniereTransaction().id)
    expect(ligne.referenceFournisseur).toBe(fauxKpay.derniereTransaction().reference)
    expect(ligne.prochaineVerification?.getTime()).toBe(maintenant.getTime() + 15 * SECONDE_MS)
    expect(ligne.expireAvant.getTime()).toBe(maintenant.getTime() + minutes(15))
    expect(ligne.telephoneEmpreinte).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should send the provider exactly one request with the external id equal to our payment id and the international number', async () => {
    const user = await createUser()

    const paiement = await initier(user.id, { periodeMois: 1 })

    expect(fauxKpay.initiations).toHaveLength(1)
    expect(fauxKpay.initiations[0]?.corps).toEqual({
      amount: 5000,
      provider: 'MTN_MOMO_CMR',
      phoneNumber: NUMERO_INTERNATIONAL,
      externalId: paiement.id,
      currency: 'XAF',
      description: 'Brandself — abonnement 1 mois',
    })
  })

  it('should keep the phone number in NO column, NO outbox line and NO Redis key or value (CA27)', async () => {
    const user = await createUser()

    await initier(user.id)

    expect(await ouLeNumeroApparait(NUMERO_NATIONAL, NUMERO_INTERNATIONAL)).toEqual([])
    const texte = await db.execute<{ t: string }>(sql`SELECT row_to_json(p)::text AS t FROM paiements p`)
    expect(texte.rows[0]?.t).not.toContain(NUMERO_NATIONAL)
  })

  it('should route an Orange payment to the Orange operator code', async () => {
    const user = await createUser()

    await initier(user.id, { moyen: 'kpay:ORANGE_CMR' })

    expect(fauxKpay.initiations[0]?.corps).toMatchObject({ provider: 'ORANGE_CMR' })
  })

  it('should commit the `cree` row BEFORE calling the provider : the external id is already known in the database (CA28)', async () => {
    const user = await createUser()
    let vuPendantAppel: { statut: string, userId: string | null } | undefined
    fauxKpay.surInitiation(async (requete) => {
      const externalId = String(requete.corps?.externalId)
      const [ligne] = await db.select().from(paiements).where(eq(paiements.id, externalId))
      vuPendantAppel = ligne ? { statut: ligne.statut, userId: ligne.userId } : undefined
    })

    const paiement = await initier(user.id)

    expect(vuPendantAppel).toEqual({ statut: 'cree', userId: user.id })
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should never regress a payment that the webhook already succeeded while the initiation call was in flight', async () => {
    const user = await createUser()
    fauxKpay.surInitiation(async (requete) => {
      const corps = corpsWebhook({ paymentId: 'tx_rapide', externalId: String(requete.corps?.externalId), amount: Number(requete.corps?.amount) })
      expect((await recevoir(corps)).status).toBe(200)
    })

    const paiement = await initier(user.id)

    expect(paiement.statut).toBe('reussi')
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
    expect(await lireAbonnement(user.id)).toBeDefined()
  })
})

describe('refus et incertitude du fournisseur (CA29)', () => {
  it('should answer 422 PAIEMENT_REFUSE and record a failed payment REQUETE_REFUSEE when the provider answers 400', async () => {
    const user = await createUser()
    fauxKpay.definirInitiation({ type: 'http', status: 400 })

    const erreur = await rejet(initier(user.id))

    expect(erreur).toMatchObject({ code: 'PAIEMENT_REFUSE', status: 422, estDomainError: true })
    const [ligne] = await lirePaiementsDe(user.id)
    expect(ligne).toMatchObject({ statut: 'echoue', codeEchec: 'REQUETE_REFUSEE', idFournisseur: null, prochaineVerification: null })
    expect(ligne?.termineLe).not.toBeNull()
  })

  it.each([
    ['a 409 (the external id exists at the provider)', { type: 'http', status: 409 } as const],
    ['a cut connection', { type: 'coupure' } as const],
    ['an invalid JSON answer', { type: 'json-invalide' } as const],
  ])('should keep the payment `en_attente` and uncertain after %s', async (_libelle, scenario) => {
    const user = await createUser()
    fauxKpay.definirInitiation(scenario)

    const paiement = await initier(user.id)

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'en_attente', initiationIncertaine: true, idFournisseur: null, prochaineVerification: null })
  })

  it('should keep the payment `en_attente` and uncertain when the provider times out, and never retry', async () => {
    const user = await createUser()
    fauxKpay.definirInitiation({ type: 'silence' })
    const { creerKpayProvider } = await import('../../server/services/paiements/fournisseurs/kpay/adaptateur')
    const rapide = creerKpayProvider({
      baseUrl: fauxKpay.url, cleApi: KPAY_TEST_CLE_API, cleSecrete: KPAY_TEST_CLE_SECRETE, environnement: 'test', secretWebhook: KPAY_TEST_SECRET_WEBHOOK, delaiInitiationMs: 300,
    })

    const paiement = await initier(user.id, {}, new Date(), { provider: rapide })

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'en_attente', initiationIncertaine: true, idFournisseur: null })
    expect(fauxKpay.initiations).toHaveLength(1)
  })

  it('should treat an unexpected exception of the provider as an uncertain outcome, not as a 500 that loses the payment row', async () => {
    const user = await createUser()
    const reel = await providerKpay()
    const casse = { ...reel, initier: () => Promise.reject(new Error('boom')) }

    const paiement = await initier(user.id, {}, new Date(), { provider: casse })

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'en_attente', initiationIncertaine: true })
  })

  it('should answer 503 FOURNISSEUR_INDISPONIBLE with a retry delay and mark the payment failed when the provider answers 500', async () => {
    const user = await createUser()
    fauxKpay.definirInitiation({ type: 'http', status: 500 })

    const erreur = await rejet(initier(user.id))

    expect(erreur).toMatchObject({ code: 'FOURNISSEUR_INDISPONIBLE', status: 503 })
    expect(erreur.retryAfter ?? 0).toBeGreaterThan(0)
    expect((await lirePaiementsDe(user.id))[0]?.statut).toBe('echoue')
  })

  it('should answer a neutral 503 PAIEMENT_INDISPONIBLE (configuration) when the provider rejects our keys', async () => {
    const user = await createUser()
    fauxKpay.definirInitiation({ type: 'http', status: 401 })

    const erreur = await rejet(initier(user.id))

    expect(erreur).toMatchObject({ code: 'PAIEMENT_INDISPONIBLE', status: 503 })
  })
})

describe('entrées refusées avant tout effet (CA30, CA31)', () => {
  async function aucunEffet(userId: string): Promise<void> {
    expect(await lirePaiementsDe(userId)).toHaveLength(0)
    expect(fauxKpay.requetes).toHaveLength(0)
  }

  it.each([
    ['an inactive wallet', { moyen: 'kpay:ORANGE_CIV' }, 'MOYEN_PAIEMENT_INVALIDE'],
    ['an unknown wallet', { moyen: 'kpay:INCONNU_X' }, 'MOYEN_PAIEMENT_INVALIDE'],
    ['an unknown provider', { moyen: 'stripe:CARTE' }, 'MOYEN_PAIEMENT_INVALIDE'],
    ['a currency that is not payable', { devise: 'EUR' }, 'DEVISE_NON_PAYABLE'],
    ['a currency different from the wallet one', { devise: 'USD' }, 'DEVISE_NON_PAYABLE'],
    ['a number of another operator format', { telephone: '0653456789' }, 'TELEPHONE_INVALIDE'],
    ['a number of another country', { telephone: '+33653456789' }, 'TELEPHONE_INVALIDE'],
  ])('should answer 422 %s and create nothing', async (_libelle, surcharges, code) => {
    const user = await createUser()

    const erreur = await rejet(initier(user.id, surcharges))

    expect(erreur).toMatchObject({ code, status: 422 })
    await aucunEffet(user.id)
  })

  it('should answer 503 PAIEMENT_INDISPONIBLE and create nothing when the provider keys are absent (CA31)', async () => {
    const user = await createUser()

    const erreur = await rejet(initier(user.id, {}, new Date(), { provider: null }))

    expect(erreur).toMatchObject({ code: 'PAIEMENT_INDISPONIBLE', status: 503 })
    await aucunEffet(user.id)
  })

  it('should not consume any limiter on a refused input', async () => {
    const user = await createUser()
    for (let i = 0; i < 8; i += 1) await rejet(initier(user.id, { moyen: 'kpay:ORANGE_CIV' }))

    const paiement = await initier(user.id)

    expect(paiement.statut).toBe('en_attente')
  })
})

describe('plafonds de paiements ouverts et relance (CA32)', () => {
  it('should refuse a new initiation within 60 s of the latest open payment with its id, and accept it after 60 s', async () => {
    const user = await createUser()
    const t0 = new Date()
    const premier = await initier(user.id, { periodeMois: 1 }, t0)

    const trop_tot = await rejet(initier(user.id, { periodeMois: 1 }, plus(t0, 30 * SECONDE_MS)))
    const limite = await rejet(initier(user.id, { periodeMois: 1 }, plus(t0, (PAIEMENT_RELANCE_APRES_S - 1) * SECONDE_MS)))
    const apres = await initier(user.id, { periodeMois: 1 }, plus(t0, (PAIEMENT_RELANCE_APRES_S + 1) * SECONDE_MS))

    expect(trop_tot).toMatchObject({ code: 'PAIEMENT_EN_COURS', status: 409 })
    expect(trop_tot.data?.paiementId).toBe(premier.id)
    expect(limite.code).toBe('PAIEMENT_EN_COURS')
    expect(apres.id).not.toBe(premier.id)
    expect(fauxKpay.initiations).toHaveLength(2)
  })

  it('should refuse a third open payment even after the relaunch delay (maximum 2 open payments)', async () => {
    const user = await createUser()
    const t0 = new Date()
    await initier(user.id, { telephone: '653456781' }, t0)
    await initier(user.id, { telephone: '653456782' }, plus(t0, 61 * SECONDE_MS))

    const erreur = await rejet(initier(user.id, { telephone: '653456783' }, plus(t0, 200 * SECONDE_MS)))

    expect(erreur.code).toBe('PAIEMENT_EN_COURS')
    expect(await lirePaiementsDe(user.id)).toHaveLength(2)
  })

  it('should let the user retry immediately after a failed payment (only open payments block)', async () => {
    const user = await createUser()
    const t0 = new Date()
    const premier = await initier(user.id, { telephone: '653456781' }, t0)
    await db.update(paiements).set({ statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND', termineLe: t0, prochaineVerification: null }).where(eq(paiements.id, premier.id))

    const second = await initier(user.id, { telephone: '653456782' }, plus(t0, 2 * SECONDE_MS))

    expect(second.statut).toBe('en_attente')
  })

  it('should let only ONE of several simultaneous double clicks through (no double debit request)', async () => {
    const user = await createUser()
    const t0 = new Date()

    const resultats = await Promise.allSettled(Array.from({ length: 4 }, () => initier(user.id, { periodeMois: 1 }, t0)))

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await lirePaiementsDe(user.id)).toHaveLength(1)
    expect(fauxKpay.initiations).toHaveLength(1)
  })
})

describe('abus : limites par numéro et par utilisateur, Redis, budget (CA33 à CA35)', () => {
  it('should answer 429 on the 4th initiation towards the same number within 15 minutes, from different accounts (CA33)', async () => {
    const comptes = await Promise.all([createUser(), createUser(), createUser(), createUser()])
    const t0 = new Date()
    for (const compte of comptes.slice(0, 3)) await initier(compte.id, { periodeMois: 1 }, t0)

    const erreur = await rejet(initier(comptes[3]!.id, { periodeMois: 1 }, t0))

    expect(erreur).toMatchObject({ code: 'TROP_DE_REQUETES', status: 429 })
    expect(erreur.retryAfter ?? 0).toBeGreaterThan(0)
    expect(fauxKpay.initiations).toHaveLength(3)
    expect(await lirePaiementsDe(comptes[3]!.id)).toHaveLength(0)
  })

  it('should count the number by its fingerprint : the same number typed differently is the same target', async () => {
    const comptes = await Promise.all([createUser(), createUser(), createUser(), createUser()])
    const t0 = new Date()
    const saisies = ['653456789', '653 456 789', '+237653456789', '237653456789']
    for (const [i, compte] of comptes.slice(0, 3).entries()) await initier(compte.id, { periodeMois: 1, telephone: saisies[i]! }, t0)

    const erreur = await rejet(initier(comptes[3]!.id, { periodeMois: 1, telephone: saisies[3]! }, t0))

    expect(erreur.code).toBe('TROP_DE_REQUETES')
  })

  it('should answer 429 on the 6th initiation of the same user within 15 minutes (CA33)', async () => {
    const user = await createUser()
    const t0 = new Date()
    for (let i = 0; i < 5; i += 1) {
      const p = await initier(user.id, { periodeMois: 1, telephone: `65345678${i}` }, t0)
      await db.update(paiements).set({ statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND', termineLe: t0, prochaineVerification: null }).where(eq(paiements.id, p.id))
    }

    const erreur = await rejet(initier(user.id, { periodeMois: 1, telephone: '653456785' }, t0))

    expect(erreur).toMatchObject({ code: 'TROP_DE_REQUETES', status: 429 })
    expect(fauxKpay.initiations).toHaveLength(5)
  })

  it('should refuse with 503 LIMITEUR_INDISPONIBLE and call nobody when the limiter cannot count (fail-closed) (CA34)', async () => {
    journaux = espionnerJournaux()
    const user = await createUser()
    await redis.set(`limite:paiement-init:${user.id}`, 'pas-un-entier')

    const erreur = await rejet(initier(user.id))

    expect(erreur).toMatchObject({ code: 'LIMITEUR_INDISPONIBLE', status: 503 })
    expect(fauxKpay.requetes).toHaveLength(0)
    expect(await lirePaiementsDe(user.id)).toHaveLength(0)
  })

  it('should refuse with 503 and call nobody when the global provider budget counter is corrupted (fail-closed)', async () => {
    journaux = espionnerJournaux()
    const user = await createUser()
    await redis.set('limite:kpay:appels', 'corrompu')

    const erreur = await rejet(initier(user.id))

    expect(erreur.status).toBe(503)
    expect(fauxKpay.requetes).toHaveLength(0)
    expect(await lirePaiementsDe(user.id)).toHaveLength(0)
  })

  it('should answer 503 FOURNISSEUR_INDISPONIBLE with a Retry-After and create nothing when the global budget of 60 calls/min is spent (CA35)', async () => {
    const user = await createUser()
    await saturerBudgetKpay(60)

    const erreur = await rejet(initier(user.id))

    expect(erreur).toMatchObject({ code: 'FOURNISSEUR_INDISPONIBLE', status: 503 })
    expect(erreur.retryAfter ?? 0).toBeGreaterThan(0)
    expect(fauxKpay.requetes).toHaveLength(0)
    expect(await lirePaiementsDe(user.id)).toHaveLength(0)
  })

  it('should count every initiation in the shared budget counter', async () => {
    const user = await createUser()

    await initier(user.id, { periodeMois: 1 })

    const valeur = (await redis.get('limite:kpay:appels')) ?? (await redis.get('kpay:appels'))
    expect(Number(valeur)).toBe(1)
  })
})

describe('lecture d’un paiement (CA36)', () => {
  it('should answer 404 PAIEMENT_INTROUVABLE for the payment of another user, like for an unknown id (no oracle)', async () => {
    const proprietaire = await createUser()
    const intrus = await createUser()
    const paiement = await initier(proprietaire.id)
    const { getOwnPaiement } = await moduleAbonnements()

    const autrui = await rejet(getOwnPaiement(intrus.id, paiement.id))
    const inconnu = await rejet(getOwnPaiement(intrus.id, '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'))
    const sien = await getOwnPaiement(proprietaire.id, paiement.id)

    expect(autrui).toMatchObject({ code: 'PAIEMENT_INTROUVABLE', status: 404 })
    expect(inconnu).toMatchObject({ code: 'PAIEMENT_INTROUVABLE', status: 404 })
    expect(autrui.message).toBe(inconnu.message)
    expect(sien.id).toBe(paiement.id)
  })

  it('should limit the status polling per user (60/min) without ever calling the provider', async () => {
    const user = await createUser()
    const paiement = await initier(user.id)
    const { suivrePaiement } = await moduleAbonnements()
    const appelsAvant = fauxKpay.requetes.length

    for (let i = 0; i < 60; i += 1) await suivrePaiement(user.id, paiement.id)
    const erreur = await rejet(suivrePaiement(user.id, paiement.id))

    expect(erreur).toMatchObject({ code: 'TROP_DE_REQUETES', status: 429 })
    expect(fauxKpay.requetes.length).toBe(appelsAvant)
  })
})

describe('frais : snapshot sur chaque paiement (CA12, CA37)', () => {
  const FRAIS_CLIENT = { kpay: { mobile_money: { tauxPointsBase: 500, supporteur: 'client' as const } } }
  const FRAIS_600 = { kpay: { mobile_money: { tauxPointsBase: 600, supporteur: 'marchand' as const } } }

  it('should ask the provider for the increased amount when the customer bears the fees (CA37)', async () => {
    const user = await createUser()

    const paiement = await initier(user.id, { periodeMois: 1 }, new Date(), { config: { frais: FRAIS_CLIENT } })

    expect(fauxKpay.initiations[0]?.corps).toMatchObject({ amount: 5264 })
    expect(await lirePaiement(paiement.id)).toMatchObject({ montant: 5264, montantPlan: 5000, fraisEstimes: 264, netEstime: 5000, fraisSupporteur: 'client', fraisTauxPb: 500 })
  })

  it('should keep the amounts and the rate of an existing payment when the configuration changes afterwards (CA12)', async () => {
    const premier = await createUser()
    const second = await createUser()
    const ancien = await initier(premier.id, { periodeMois: 1 })

    const recent = await initier(second.id, { periodeMois: 1, telephone: '653456780' }, new Date(), { config: { frais: FRAIS_600 } })

    expect(await lirePaiement(ancien.id)).toMatchObject({ fraisTauxPb: 500, fraisEstimes: 250, netEstime: 4750, montant: 5000 })
    expect(await lirePaiement(recent.id)).toMatchObject({ fraisTauxPb: 600, fraisEstimes: 300, netEstime: 4700, montant: 5000 })
  })

  it('should answer 503 PAIEMENT_INDISPONIBLE rather than charging without a fee configuration', async () => {
    const user = await createUser()

    const erreur = await rejet(initier(user.id, {}, new Date(), { config: { frais: {} } }))

    expect(erreur.code).toBe('PAIEMENT_INDISPONIBLE')
    expect(await lirePaiementsDe(user.id)).toHaveLength(0)
  })

  it('should price every period from the configuration, not from the client (1 month 5000, 3 months 13500, 12 months 48000)', async () => {
    const montants: number[] = []
    for (const [i, periodeMois] of ([1, 3, 12] as const).entries()) {
      const user = await createUser()
      const p = await initier(user.id, { periodeMois, telephone: `65345678${i}` })
      montants.push(p.montant)
    }

    expect(montants).toEqual([5000, 13500, 48000])
  })
})

describe('journaux (CA98)', () => {
  it('should never log the number, a key, the secret or a provider body, across success, refusal, timeout and unavailability', async () => {
    journaux = espionnerJournaux()
    const user = await createUser()
    const scenarios = [{ type: 'succes' }, { type: 'http', status: 400, corps: { message: `Numéro ${NUMERO_INTERNATIONAL} invalide` } }, { type: 'http', status: 500 }, { type: 'coupure' }, { type: 'json-invalide' }] as const
    for (const [i, scenario] of scenarios.entries()) {
      fauxKpay.definirInitiation(scenario)
      const p = await initier(user.id, { periodeMois: 1, telephone: `65345678${i}` }).catch(() => undefined)
      if (p) await db.update(paiements).set({ statut: 'echoue', codeEchec: 'X', termineLe: new Date(), prochaineVerification: null }).where(eq(paiements.id, p.id))
      await db.execute(sql`UPDATE paiements SET statut = 'echoue', code_echec = 'X', termine_le = now(), prochaine_verification = NULL WHERE statut IN ('cree','en_attente')`)
    }

    const sortie = journaux.contenu()
    for (const interdit of [NUMERO_NATIONAL, NUMERO_INTERNATIONAL, '65345678', KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK, 'phoneNumber', 'Numéro 237']) {
      expect(sortie).not.toContain(interdit)
    }
  })
})
