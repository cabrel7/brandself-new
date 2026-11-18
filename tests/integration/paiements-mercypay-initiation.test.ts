import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MERCY_PAY_ECRITURES_MAX_PAR_MINUTE } from '../../shared/limites'
import { redis } from '../../server/utils/redis'
import { decrirePaiement } from '../../server/services/paiements/fournisseurs'
import { demarrerFauxMercyPay, MERCY_TEST_CLE_API, MERCY_TEST_SECRET_WEBHOOK } from '../support/faux-mercypay'
import type { FauxMercyPay } from '../support/faux-mercypay'
import {
  initier,
  lirePaiement,
  lirePaiementsDe,
  moduleFournisseurs,
  NUMERO_INTERNATIONAL,
  NUMERO_NATIONAL,
  ouLeNumeroApparait,
} from './support/abonnements'
import { rejet } from './support/erreurs'
import { createUser } from './support/fabriques'
import { espionnerJournaux } from './support/planification'
import type { EspionJournaux } from './support/planification'

// P1 CA-M05, CA-M06, CA-M18 : initiation d'un paiement Mobile Money par Mercy Pay. VRAIE base PostgreSQL, VRAI Redis (limiteurs
// et budget), VRAI adaptateur Mercy Pay ; SEUL le serveur Mercy est factice (tests/support/faux-mercypay.ts, 127.0.0.1). Le service
// `initierPaiement` est appelé avec une horloge injectée et le fournisseur injecté (`deps.provider`) : le catalogue des moyens
// (`mercypay:MTN_MOMO_CMR`) est lu comme en production, il doit donc être actif dans la version courante du catalogue.
// Prérequis : migration 0033 (`source = 'fournisseur'`), sinon l'insertion échoue sur `paiements_source_check`.

const MOYEN = 'mercypay:MTN_MOMO_CMR'
const ENTREE = { moyen: MOYEN, periodeMois: 1, prixAffiche: 5000 } as const

let faux: FauxMercyPay
let journaux: EspionJournaux | undefined

beforeAll(async () => {
  faux = await demarrerFauxMercyPay()
})
afterAll(async () => {
  await faux.fermer()
})
beforeEach(async () => {
  faux.reinitialiser()
  // Une base Redis PAR worker (index /15-k, garde du setup) : les compteurs du budget Mercy n'ont pas de préfixe commun.
  await redis.flushdb()
})
afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function providerMercy(options: { delaiInitiationMs?: number } = {}) {
  const { creerMercyPayProvider } = await import('../../server/services/paiements/fournisseurs/mercypay/adaptateur')
  return creerMercyPayProvider({
    baseUrl: faux.baseUrl,
    cleApi: MERCY_TEST_CLE_API,
    environnement: 'test',
    secretWebhook: MERCY_TEST_SECRET_WEBHOOK,
    ...options,
  })
}

async function providerDuRegistre() {
  const { getPaiementProvider } = await moduleFournisseurs()
  const provider = getPaiementProvider('mercypay', {
    KPAY_API_KEY: undefined,
    KPAY_SECRET_KEY: undefined,
    KPAY_WEBHOOK_SECRET: undefined,
    KPAY_BASE_URL: 'https://admin.kpay.site',
    MERCY_PAY_API_KEY: MERCY_TEST_CLE_API,
    MERCY_PAY_WEBHOOK_SECRET: undefined,
    MERCY_PAY_BASE_URL: faux.baseUrl,
  })
  if (provider === null) throw new Error('Mercy Pay devrait être configuré par le registre quand sa clé est présente.')
  return provider
}

describe('initiation réussie (CA-M05)', () => {
  it('should send Mercy exactly one POST /payments with Bearer, Idempotency-Key = payment id, integer amount, country and metadata', async () => {
    const user = await createUser()
    const provider = await providerDuRegistre()

    const paiement = await initier(user.id, ENTREE, new Date(), { provider })

    expect(faux.initiations).toHaveLength(1)
    const envoyee = faux.initiations[0]
    expect(envoyee?.entetes.authorization).toBe(`Bearer ${MERCY_TEST_CLE_API}`)
    expect(envoyee?.entetes['idempotency-key']).toBe(paiement.id)
    expect(paiement.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(envoyee?.corps).toMatchObject({
      amount: 5000,
      currency: 'XAF',
      payment_method: 'mobile_money',
      country: 'CMR',
      provider: 'MTN_MOMO_CMR',
      phone: NUMERO_INTERNATIONAL,
      metadata: { paiement_id: paiement.id },
    })
    expect(Number.isInteger(envoyee?.corps?.amount)).toBe(true)
  })

  it('should store the payment `en_attente` with the pay_ identifier, the provider name, the `fournisseur` source and the Mercy fee snapshot', async () => {
    const user = await createUser()
    const provider = await providerDuRegistre()

    const paiement = await initier(user.id, ENTREE, new Date(), { provider })

    const ligne = await lirePaiement(paiement.id)
    expect(ligne.idFournisseur).toBe(faux.dernierPaiement().id)
    expect(ligne.idFournisseur).toMatch(/^pay_/)
    expect(ligne).toMatchObject({
      userId: user.id,
      statut: 'en_attente',
      fournisseur: 'mercypay',
      source: 'fournisseur',
      methode: 'mobile_money',
      operateur: 'MTN_MOMO_CMR',
      environnement: 'test',
      montant: 5000,
      devise: 'XAF',
      fraisTauxPb: 350,
      fraisSupporteur: 'marchand',
      fraisEstimes: 175,
      netEstime: 4825,
      initiationIncertaine: false,
    })
  })

  it('should keep the phone number in NO column, NO outbox line and NO Redis key or value, and never log the number or the key', async () => {
    journaux = espionnerJournaux()
    const user = await createUser()
    const provider = await providerDuRegistre()

    await initier(user.id, ENTREE, new Date(), { provider })

    expect(await ouLeNumeroApparait(NUMERO_NATIONAL, NUMERO_INTERNATIONAL)).toEqual([])
    const sortie = journaux.contenu()
    expect(sortie).not.toContain(NUMERO_NATIONAL)
    expect(sortie).not.toContain(MERCY_TEST_CLE_API)
  })

  it('should route an Orange payment to the Orange operator code', async () => {
    const user = await createUser()
    const provider = await providerDuRegistre()

    await initier(user.id, { ...ENTREE, moyen: 'mercypay:ORANGE_CMR' }, new Date(), { provider })

    expect(faux.initiations[0]?.corps).toMatchObject({ provider: 'ORANGE_CMR', country: 'CMR' })
  })

  it('should use a different Idempotency-Key for each payment (the key is the payment id, never reused across users)', async () => {
    const [a, b] = [await createUser(), await createUser()]
    const provider = await providerDuRegistre()

    await initier(a.id, ENTREE, new Date(), { provider })
    await initier(b.id, { ...ENTREE, telephone: '653456780' }, new Date(), { provider })

    const cles = faux.initiations.map((i) => i.entetes['idempotency-key'])
    expect(new Set(cles).size).toBe(2)
    expect(faux.rejeux()).toBe(0)
  })

  it('should mark the payment `echoue` (REQUETE_REFUSEE) when Mercy refuses it with a 422, nothing being created at Mercy', async () => {
    faux.definirInitiation({ type: 'http', status: 422, corps: { error: { code: 'invalid_phone_number', message: 'x' } } })
    const user = await createUser()
    const provider = await providerDuRegistre()

    // Contrat existant (comme K-PAY, paiements-initiation CA29) : le paiement est enregistré `echoue`, puis le service lève 422.
    const erreur = await rejet(initier(user.id, ENTREE, new Date(), { provider }))

    expect(erreur).toMatchObject({ code: 'PAIEMENT_REFUSE', status: 422, estDomainError: true })
    const [paiement] = await lirePaiementsDe(user.id)
    expect(paiement).toMatchObject({ statut: 'echoue', codeEchec: 'REQUETE_REFUSEE', idFournisseur: null })
    expect(faux.paiements.size).toBe(0)
  })
})

describe('délai dépassé puis rejeu idempotent (CA-M06)', () => {
  it('should flag the initiation uncertain when the call times out, while Mercy DID create the payment', async () => {
    faux.definirInitiation({ type: 'lent', delaiMs: 800 })
    const user = await createUser()
    const provider = await providerMercy({ delaiInitiationMs: 150 })

    const paiement = await initier(user.id, ENTREE, new Date(), { provider })

    expect(paiement).toMatchObject({ statut: 'en_attente', initiationIncertaine: true, idFournisseur: null })
    expect((await lirePaiement(paiement.id)).initiationIncertaine).toBe(true)
    expect(faux.paiements.size).toBe(1)
  })

  it('should replay the ORIGINAL answer for the same key and the same body: a single pay_ identifier, `Idempotent-Replayed: true`', async () => {
    faux.definirInitiation({ type: 'lent', delaiMs: 800 })
    const user = await createUser()
    const provider = await providerMercy({ delaiInitiationMs: 150 })
    const paiement = await initier(user.id, ENTREE, new Date(), { provider })
    const premiere = faux.initiations[0]
    const creeChezMercy = faux.dernierPaiement()
    faux.definirInitiation({ type: 'succes' })
    const description = String(premiere?.corps?.description)

    const rejeu = await provider.initier(
      { externalId: paiement.id, montant: 5000, devise: 'XAF', operateur: 'MTN_MOMO_CMR', telephoneInternational: NUMERO_INTERNATIONAL, description },
      AbortSignal.timeout(5_000),
    )

    expect(rejeu).toMatchObject({ issue: 'accepte', idFournisseur: creeChezMercy.id })
    expect(faux.initiations).toHaveLength(2)
    expect(faux.initiations[1]?.entetes['idempotency-key']).toBe(paiement.id)
    expect(faux.initiations[1]?.corpsBrut).toBe(premiere?.corpsBrut)
    expect(faux.rejeux()).toBe(1)
    expect(faux.paiements.size).toBe(1)
  })

  it('should answer `incertain/DOUBLON` (never a second payment) when the same key is replayed while Mercy still handles the first call', async () => {
    let relacher: () => void = () => undefined
    const bloque = new Promise<void>((resolve) => {
      relacher = resolve
    })
    faux.surInitiation(() => bloque)
    const user = await createUser()
    const provider = await providerMercy()
    const premiere = initier(user.id, ENTREE, new Date(), { provider })
    // On attend que Mercy ait REÇU le premier appel (et non un délai fixe : la machine peut être lente).
    await vi.waitFor(() => expect(faux.initiations).toHaveLength(1), { timeout: 20_000, interval: 50 })
    const descriptionPrevue = decrirePaiement('mercypay', 1)

    const pendant = await provider.initier(
      { externalId: String(faux.initiations[0]?.entetes['idempotency-key']), montant: 5000, devise: 'XAF', operateur: 'MTN_MOMO_CMR', telephoneInternational: NUMERO_INTERNATIONAL, description: descriptionPrevue },
      AbortSignal.timeout(5_000),
    )
    relacher()
    await premiere

    expect(pendant).toEqual({ issue: 'incertain', code: 'DOUBLON' })
    expect(faux.paiements.size).toBe(1)
  })
})

describe('budget d’appels Mercy Pay (CA-M18)', () => {
  async function budget() {
    return import('../../server/services/paiements/budget')
  }

  it('should accept 40 writes in the minute then refuse the 41st with 503 FOURNISSEUR_INDISPONIBLE and a retryAfter', async () => {
    const { reserverAppelFournisseur } = await budget()
    for (let i = 0; i < MERCY_PAY_ECRITURES_MAX_PAR_MINUTE; i += 1) {
      await reserverAppelFournisseur('mercypay', 'ecriture')
    }

    const erreur = await rejet(reserverAppelFournisseur('mercypay', 'ecriture'))

    expect(MERCY_PAY_ECRITURES_MAX_PAR_MINUTE).toBe(40)
    expect(erreur).toMatchObject({ code: 'FOURNISSEUR_INDISPONIBLE', status: 503 })
    expect(erreur.retryAfter).toBeGreaterThan(0)
    expect(erreur.retryAfter).toBeLessThanOrEqual(60)
  })

  it('should make NO HTTP call to Mercy when the budget is exhausted: the initiation is refused first', async () => {
    const { reserverAppelFournisseur } = await budget()
    for (let i = 0; i < MERCY_PAY_ECRITURES_MAX_PAR_MINUTE; i += 1) {
      await reserverAppelFournisseur('mercypay', 'ecriture')
    }
    journaux = espionnerJournaux()
    const user = await createUser()
    const provider = await providerDuRegistre()

    const erreur = await rejet(initier(user.id, ENTREE, new Date(), { provider }))

    expect(erreur).toMatchObject({ code: 'FOURNISSEUR_INDISPONIBLE', status: 503 })
    expect(erreur.retryAfter).toBeGreaterThan(0)
    expect(faux.requetes).toHaveLength(0)
  })

  it('should keep a separate read budget (reads still pass when the write budget is exhausted) and a separate budget per provider', async () => {
    const { reserverAppelFournisseur } = await budget()
    for (let i = 0; i < MERCY_PAY_ECRITURES_MAX_PAR_MINUTE; i += 1) {
      await reserverAppelFournisseur('mercypay', 'ecriture')
    }

    await expect(reserverAppelFournisseur('mercypay', 'lecture')).resolves.toBeUndefined()
    await expect(reserverAppelFournisseur('kpay')).resolves.toBeUndefined()
  })

  it('should count concurrent writes atomically: 60 simultaneous reservations let exactly 40 through', async () => {
    const { reserverAppelFournisseur } = await budget()

    const resultats = await Promise.allSettled(Array.from({ length: 60 }, () => reserverAppelFournisseur('mercypay', 'ecriture')))

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(MERCY_PAY_ECRITURES_MAX_PAR_MINUTE)
    expect(resultats.filter((r) => r.status === 'rejected')).toHaveLength(60 - MERCY_PAY_ECRITURES_MAX_PAR_MINUTE)
  })

  it('should refuse with 503 LIMITEUR_INDISPONIBLE and call nobody when the counter cannot be read (fail-closed)', async () => {
    const { reserverAppelFournisseur } = await budget()
    const avant = new Set(await redis.keys('*'))
    await reserverAppelFournisseur('mercypay', 'ecriture')
    const nouvelles = (await redis.keys('*')).filter((cle) => !avant.has(cle))
    expect(nouvelles.length).toBeGreaterThan(0)
    for (const cle of nouvelles) await redis.set(cle, 'pas-un-entier')

    const erreur = await rejet(reserverAppelFournisseur('mercypay', 'ecriture'))

    expect(erreur).toMatchObject({ code: 'LIMITEUR_INDISPONIBLE', status: 503 })
    expect(faux.requetes).toHaveLength(0)
  })
})
