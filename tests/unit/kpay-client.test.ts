import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  demarrerFauxKpay,
  KPAY_TEST_CLE_API,
  KPAY_TEST_CLE_SECRETE,
  KPAY_TEST_SECRET_WEBHOOK,
  NUMEROS_SANDBOX,
} from '../support/faux-kpay'
import type { FauxKpay } from '../support/faux-kpay'
import { espionnerConsole, moduleKpay, moduleKpayConstantes } from './support/s10'
import type { EspionConsole } from './support/s10'

// S10 §6 CA17 à CA22 : client K-PAY contre le FAUX SERVEUR HTTP local (node:http, 127.0.0.1). L'adaptateur est le vrai
// code de production ; seule l'API tierce est factice. Aucun nouvel essai, aucune clé ni numéro dans les journaux.

let faux: FauxKpay
let secondServeur: FauxKpay
let journaux: EspionConsole | undefined

beforeAll(async () => {
  faux = await demarrerFauxKpay()
  secondServeur = await demarrerFauxKpay()
})

afterAll(async () => {
  await faux.fermer()
  await secondServeur.fermer()
})

beforeEach(() => {
  faux.reinitialiser()
  secondServeur.reinitialiser()
  journaux = espionnerConsole()
})

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function creerProvider(surcharges: { delaiInitiationMs?: number, delaiConsultationMs?: number, secretWebhook?: string | undefined } = {}) {
  const { creerKpayProvider } = await moduleKpay()
  return creerKpayProvider({
    baseUrl: faux.url,
    cleApi: KPAY_TEST_CLE_API,
    cleSecrete: KPAY_TEST_CLE_SECRETE,
    environnement: 'test',
    secretWebhook: KPAY_TEST_SECRET_WEBHOOK,
    ...surcharges,
  })
}

function requete(surcharges: Partial<{ externalId: string, montant: number, devise: string, operateur: string, telephoneInternational: string, description: string }> = {}) {
  return {
    externalId: randomUUID(),
    montant: 5000,
    devise: 'XAF',
    operateur: 'MTN_MOMO_CMR',
    telephoneInternational: '237653456789',
    description: 'Brandself — abonnement 1 mois',
    ...surcharges,
  }
}

const SIGNAL = () => AbortSignal.timeout(5_000)

describe('initier : requête envoyée (CA17)', () => {
  it('should POST /api/v1/payments/init with the three headers and the exact body, nothing more', async () => {
    const provider = await creerProvider()
    const demande = requete()

    const resultat = await provider.initier(demande, SIGNAL())

    expect(faux.initiations).toHaveLength(1)
    const recue = faux.initiations[0]!
    expect(recue.methode).toBe('POST')
    expect(recue.chemin).toBe('/api/v1/payments/init')
    expect(recue.entetes['x-api-key']).toBe(KPAY_TEST_CLE_API)
    expect(recue.entetes['x-secret-key']).toBe(KPAY_TEST_CLE_SECRETE)
    expect(recue.entetes['content-type']).toContain('application/json')
    expect(recue.corps).toEqual({
      amount: 5000,
      provider: 'MTN_MOMO_CMR',
      phoneNumber: '237653456789',
      externalId: demande.externalId,
      currency: 'XAF',
      description: 'Brandself — abonnement 1 mois',
    })
    expect(recue.corps).not.toHaveProperty('customerEmail')
    expect(recue.corps).not.toHaveProperty('metadata')
    expect(recue.corps).not.toHaveProperty('paymentMethod')
    expect(recue.corps).not.toHaveProperty('returnUrl')
    expect(resultat).toMatchObject({ issue: 'accepte', statutFournisseur: 'PENDING' })
    expect(resultat.issue === 'accepte' && resultat.idFournisseur).toBe(faux.derniereTransaction().id)
  })

  it('should send the amount as an integer number, never a string nor a decimal', async () => {
    const provider = await creerProvider()

    await provider.initier(requete({ montant: 48000 }), SIGNAL())

    expect(faux.initiations[0]?.corpsBrut).toContain('"amount":48000')
  })

  it('should keep the reference given by the provider and tolerate unknown response fields (CA20)', async () => {
    faux.definirInitiation({ type: 'succes', reference: 'KPAY-20261103-ABC123', champsSupplementaires: { champInconnu: { a: 1 }, autre: [1, 2] } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat).toMatchObject({ issue: 'accepte', referenceFournisseur: 'KPAY-20261103-ABC123' })
    expect(JSON.stringify(resultat)).not.toContain('champInconnu')
    expect(JSON.stringify(resultat)).not.toContain('237653456789')
  })

  it('should accept an initiation answer that only carries id, reference and status (revue MAJOR-3)', async () => {
    faux.definirInitiation({ type: 'http', status: 201, corps: { id: 'tx_minimal', reference: 'KPAY-MIN', status: 'PENDING' } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat).toMatchObject({ issue: 'accepte', idFournisseur: 'tx_minimal', referenceFournisseur: 'KPAY-MIN' })
  })

  it.each([
    ['another externalId', (demande: { externalId: string }) => ({ id: 'tx_x', status: 'PENDING', externalId: `${demande.externalId}-autre` })],
    ['another amount', () => ({ id: 'tx_x', status: 'PENDING', amount: 1 })],
  ])('should not bind the identifier to our payment when the answer carries %s : uncertain outcome, logged by code only', async (_nom, corps) => {
    const demande = requete()
    faux.definirInitiation({ type: 'http', status: 201, corps: corps(demande) })
    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const provider = await creerProvider()

    const resultat = await provider.initier(demande, SIGNAL())

    expect(resultat).toEqual({ issue: 'incertain', code: 'RESEAU' })
    expect(journal).toHaveBeenCalledWith({ paiement: 'kpay_initiation_reponse_incoherente', code: 'REPONSE_INCOHERENTE' })
    journal.mockRestore()
  })

  it('should refuse a currency with decimals or a non integer amount BEFORE any call', async () => {
    const provider = await creerProvider()

    const eur = await provider.initier(requete({ devise: 'EUR' }), SIGNAL())
    const decimal = await provider.initier(requete({ montant: 50.5 }), SIGNAL())
    const nul = await provider.initier(requete({ montant: 0 }), SIGNAL())

    expect(eur.issue).toBe('refuse')
    expect(decimal.issue).toBe('refuse')
    expect(nul.issue).toBe('refuse')
    expect(faux.initiations).toHaveLength(0)
  })
})

describe('initier : réponses d’erreur (CA18)', () => {
  it('should map a 400 to a refusal with a code that is not the provider message', async () => {
    faux.definirInitiation({ type: 'http', status: 400, corps: { message: 'Numéro 237653456789 invalide' } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat.issue).toBe('refuse')
    expect(resultat.issue === 'refuse' && resultat.code).toMatch(/^[A-Z0-9_]{1,64}$/)
    expect(JSON.stringify(resultat)).not.toContain('237653456789')
  })

  it.each([401, 403])('should map %i to an unavailable provider (authentication)', async (status) => {
    faux.definirInitiation({ type: 'http', status })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'AUTH' })
  })

  it('should map a 409 to an uncertain outcome DOUBLON (the externalId already exists at the provider)', async () => {
    faux.definirInitiation({ type: 'http', status: 409 })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'incertain', code: 'DOUBLON' })
  })

  it('should map a 429 with Retry-After: 30 to LIMITE with retryAfterS = 30', async () => {
    faux.definirInitiation({ type: 'http', status: 429, entetes: { 'retry-after': '30' } })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'LIMITE', retryAfterS: 30 })
  })

  it('should cap an absurd Retry-After and ignore an unreadable one', async () => {
    const provider = await creerProvider()
    faux.definirInitiation({ type: 'http', status: 429, entetes: { 'retry-after': '99999999' } })
    const absurde = await provider.initier(requete(), SIGNAL())
    faux.definirInitiation({ type: 'http', status: 429, entetes: { 'retry-after': 'demain' } })
    const illisible = await provider.initier(requete(), SIGNAL())

    expect(absurde.issue === 'indisponible' && absurde.retryAfterS).toBeLessThanOrEqual(3_600)
    expect(illisible).toEqual({ issue: 'indisponible', code: 'LIMITE' })
  })

  it.each([500, 502, 503, 504])('should map %i to SERVEUR', async (status) => {
    faux.definirInitiation({ type: 'http', status })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'SERVEUR' })
  })

  it('should never retry : exactly one request per initiation, whatever the answer', async () => {
    faux.definirInitiation({ type: 'http', status: 503 })
    const provider = await creerProvider()

    await provider.initier(requete(), SIGNAL())

    expect(faux.initiations).toHaveLength(1)
  })

  it('should not follow a redirect : the keys must never be sent to another host', async () => {
    faux.definirInitiation({ type: 'http', status: 302, entetes: { location: `${secondServeur.url}/api/v1/payments/init` } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(secondServeur.requetes).toHaveLength(0)
    expect(resultat.issue).not.toBe('accepte')
  })
})

describe('initier : délai et réponses invalides (CA19, CA20)', () => {
  it('should give up with an uncertain DELAI when the server never answers, without a second request', async () => {
    faux.definirInitiation({ type: 'silence' })
    const provider = await creerProvider()
    const debut = Date.now()

    const resultat = await provider.initier(requete(), AbortSignal.timeout(300))

    expect(resultat).toEqual({ issue: 'incertain', code: 'DELAI' })
    expect(Date.now() - debut).toBeLessThan(300 + 200)
    expect(faux.initiations).toHaveLength(1)
  })

  it('should apply its own timeout even when the caller signal never fires (KPAY_DELAI_INITIATION_MS by default)', async () => {
    const { KPAY_DELAI_INITIATION_MS } = await moduleKpayConstantes()
    faux.definirInitiation({ type: 'silence' })
    const provider = await creerProvider({ delaiInitiationMs: 250 })
    const debut = Date.now()

    const resultat = await provider.initier(requete(), new AbortController().signal)

    expect(KPAY_DELAI_INITIATION_MS).toBe(10_000)
    expect(resultat).toEqual({ issue: 'incertain', code: 'DELAI' })
    expect(Date.now() - debut).toBeLessThan(250 + 200)
  })

  it('should report an uncertain RESEAU when the connection is cut', async () => {
    faux.definirInitiation({ type: 'coupure' })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'incertain', code: 'RESEAU' })
  })

  it('should report an uncertain RESEAU when nobody listens (connection refused)', async () => {
    const { creerKpayProvider } = await moduleKpay()
    const provider = creerKpayProvider({ baseUrl: 'http://127.0.0.1:1', cleApi: KPAY_TEST_CLE_API, cleSecrete: KPAY_TEST_CLE_SECRETE, environnement: 'test' })

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'incertain', code: 'RESEAU' })
  })

  it.each([
    ['a 201 with an invalid JSON body', { type: 'json-invalide' } as const],
    ['a 201 without id', { type: 'sans-id' } as const],
    ['a 201 whose body is far too large', { type: 'http', status: 201, corps: JSON.stringify({ id: 'tx_1', status: 'PENDING', amount: 5000, externalId: 'x', bruit: 'a'.repeat(200_000) }) } as const],
  ])('should treat %s as an uncertain RESEAU (the payment may exist)', async (_libelle, scenario) => {
    faux.definirInitiation(scenario)
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'incertain', code: 'RESEAU' })
  })
})

describe('consulter (CA21)', () => {
  async function initieeAvec(numero: string) {
    faux.definirInitiation({ type: 'selon-numero' })
    const provider = await creerProvider()
    const resultat = await provider.initier(requete({ telephoneInternational: numero }), SIGNAL())
    if (resultat.issue !== 'accepte') throw new Error('initiation attendue')
    return { provider, id: resultat.idFournisseur }
  }

  it('should read a completed payment with the real fees and net amount', async () => {
    const { provider, id } = await initieeAvec(NUMEROS_SANDBOX.succes)
    faux.modifierTransaction(id, { feeAmount: 250, netAmount: 4750 })

    const etat = await provider.consulter(id, SIGNAL())

    expect(etat).toMatchObject({ idFournisseur: id, statut: 'reussi', montant: 5000, devise: 'XAF', fraisReels: 250, netReel: 4750, codeEchec: null })
  })

  it.each([
    ['PROCESSING', 'en_attente'],
    ['PENDING', 'en_attente'],
    ['SUBMITTED', 'en_attente'],
    ['CANCELLED', 'annule'],
    ['REFUNDED', 'rembourse'],
  ] as const)('should map the provider status %s to %s', async (statutKpay, attendu) => {
    const { provider, id } = await initieeAvec(NUMEROS_SANDBOX.nonTerminal)
    faux.modifierTransaction(id, { status: statutKpay })

    expect((await provider.consulter(id, SIGNAL()))?.statut).toBe(attendu)
  })

  it('should read a failure with its code', async () => {
    const { provider, id } = await initieeAvec(NUMEROS_SANDBOX.echecIntrouvable)

    expect(await provider.consulter(id, SIGNAL())).toMatchObject({ statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND' })
  })

  it('should keep only a failure code that looks like a code (never a free text message)', async () => {
    const { provider, id } = await initieeAvec(NUMEROS_SANDBOX.echecIntrouvable)
    faux.modifierTransaction(id, { failureReason: 'Le numéro 237653456789 est introuvable !' })

    const etat = await provider.consulter(id, SIGNAL())

    expect(etat?.codeEchec).toBeNull()
  })

  it('should answer null for an unknown transaction (404)', async () => {
    const provider = await creerProvider()

    expect(await provider.consulter('tx_inconnue', SIGNAL())).toBeNull()
  })

  it('should treat an unknown provider status as not terminal, never as a success', async () => {
    const { provider, id } = await initieeAvec(NUMEROS_SANDBOX.nonTerminal)
    faux.modifierTransaction(id, { status: 'STATUT_INVENTE' as never })

    expect((await provider.consulter(id, SIGNAL()))?.statut).toBe('en_attente')
  })

  it('should NOT answer null on a server error : the payment still exists, the caller must not conclude it is unknown', async () => {
    faux.definirConsultation({ type: 'http', status: 500 })
    const provider = await creerProvider()

    await expect(provider.consulter('tx_1', SIGNAL())).rejects.toMatchObject({ name: 'FournisseurIndisponibleError' })
  })

  it('should signal a rate limit with the retry delay, and an authentication failure', async () => {
    const provider = await creerProvider()
    faux.definirConsultation({ type: 'http', status: 429, entetes: { 'retry-after': '12' } })
    await expect(provider.consulter('tx_1', SIGNAL())).rejects.toMatchObject({ code: 'LIMITE', retryAfterS: 12 })
    faux.definirConsultation({ type: 'http', status: 401 })
    await expect(provider.consulter('tx_1', SIGNAL())).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('should time out on a silent server', async () => {
    faux.definirConsultation({ type: 'silence' })
    const provider = await creerProvider({ delaiConsultationMs: 250 })

    await expect(provider.consulter('tx_1', new AbortController().signal)).rejects.toMatchObject({ code: 'DELAI' })
  })

  it('should send the keys as headers and put the identifier in the path, URL encoded', async () => {
    const provider = await creerProvider()

    await provider.consulter('a/b?c=d', SIGNAL())

    const recue = faux.consultations[0]!
    expect(recue.entetes['x-api-key']).toBe(KPAY_TEST_CLE_API)
    expect(recue.chemin).toBe('/api/v1/payments/a%2Fb%3Fc%3Dd')
    expect(recue.chemin).not.toContain(KPAY_TEST_CLE_API)
  })
})

describe('journaux (CA22)', () => {
  it('should never log a key, a secret, the phone number or a response body during any call', async () => {
    const provider = await creerProvider()
    faux.definirInitiation({ type: 'selon-numero' })
    const ok = await provider.initier(requete(), SIGNAL())
    if (ok.issue !== 'accepte') throw new Error('initiation attendue')
    await provider.consulter(ok.idFournisseur, SIGNAL())
    await provider.consulter('inconnu', SIGNAL())
    for (const scenario of [{ type: 'http', status: 400, corps: { message: 'secret-message-fournisseur 237653456789' } }, { type: 'http', status: 500 }, { type: 'json-invalide' }, { type: 'coupure' }] as const) {
      faux.definirInitiation(scenario)
      await provider.initier(requete(), SIGNAL())
    }
    faux.definirConsultation({ type: 'http', status: 500 })
    await provider.consulter('x', SIGNAL()).catch(() => undefined)

    const sortie = journaux?.contenu() ?? ''
    for (const secret of [KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK, '237653456789', '653456789', 'secret-message-fournisseur', 'phoneNumber']) {
      expect(sortie).not.toContain(secret)
    }
  })
})
