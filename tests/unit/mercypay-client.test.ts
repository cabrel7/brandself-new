import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { demarrerFauxMercyPay, MERCY_CHEMIN_PAIEMENTS, MERCY_TEST_CLE_API, MERCY_TEST_SECRET_WEBHOOK } from '../support/faux-mercypay'
import type { FauxMercyPay } from '../support/faux-mercypay'
import { espionnerConsole } from './support/s10'
import type { EspionConsole } from './support/s10'

// P1 CA-M07 (+ forme de la requête, spec §2 et §4.2) : client Mercy Pay contre le FAUX SERVEUR HTTP local (127.0.0.1).
// L'adaptateur est le vrai code de production ; seule l'API tierce est factice. Aucun nouvel essai à l'intérieur de `initier`
// (le rejeu avec la même clé est l'affaire de l'appelant), aucune clé ni numéro dans les journaux.

const moduleMercyPay = () => import('../../server/services/paiements/fournisseurs/mercypay/adaptateur')
const NUMERO = '237680000000'

let faux: FauxMercyPay
let autreServeur: FauxMercyPay
let journaux: EspionConsole | undefined

beforeAll(async () => {
  faux = await demarrerFauxMercyPay()
  autreServeur = await demarrerFauxMercyPay()
})

afterAll(async () => {
  await faux.fermer()
  await autreServeur.fermer()
})

beforeEach(() => {
  faux.reinitialiser()
  autreServeur.reinitialiser()
  journaux = espionnerConsole()
})

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function creerProvider(surcharges: { delaiInitiationMs?: number, delaiConsultationMs?: number, baseUrl?: string } = {}) {
  const { creerMercyPayProvider } = await moduleMercyPay()
  return creerMercyPayProvider({
    baseUrl: faux.baseUrl,
    cleApi: MERCY_TEST_CLE_API,
    environnement: 'test',
    secretWebhook: MERCY_TEST_SECRET_WEBHOOK,
    ...surcharges,
  })
}

function requete(surcharges: Partial<{ externalId: string, montant: number, devise: string, operateur: string, telephoneInternational: string, description: string }> = {}) {
  return {
    externalId: randomUUID(),
    montant: 5000,
    devise: 'XAF',
    operateur: 'MTN_MOMO_CMR',
    telephoneInternational: NUMERO,
    description: 'jesuis.pro - abonnement 1 mois',
    ...surcharges,
  }
}

const SIGNAL = () => AbortSignal.timeout(5_000)

describe('initier : requête envoyée (spec §2, §4.2)', () => {
  it('should POST <base>/payments with Bearer auth, the idempotency key equal to our payment id and the exact body', async () => {
    const provider = await creerProvider()
    const req = requete()

    await provider.initier(req, SIGNAL())

    expect(faux.initiations).toHaveLength(1)
    const envoyee = faux.initiations[0]
    expect(envoyee?.methode).toBe('POST')
    expect(envoyee?.chemin).toBe(MERCY_CHEMIN_PAIEMENTS)
    expect(envoyee?.entetes.authorization).toBe(`Bearer ${MERCY_TEST_CLE_API}`)
    expect(envoyee?.entetes['idempotency-key']).toBe(req.externalId)
    expect(String(envoyee?.entetes['content-type'])).toContain('application/json')
    expect(envoyee?.corps).toMatchObject({
      amount: 5000,
      currency: 'XAF',
      payment_method: 'mobile_money',
      country: 'CMR',
      provider: 'MTN_MOMO_CMR',
      phone: NUMERO,
      description: req.description,
      metadata: { paiement_id: req.externalId },
    })
  })

  it('should send the amount as an INTEGER number in minor units, never a string or a float', async () => {
    const provider = await creerProvider()

    await provider.initier(requete({ montant: 48_000 }), SIGNAL())

    expect(faux.initiations[0]?.corps?.amount).toBe(48_000)
    expect(faux.initiations[0]?.corpsBrut).toMatch(/"amount":48000[,}]/)
  })

  it('should derive the country from the operator code (ORANGE_CMR -> CMR) and forward the operator as `provider`', async () => {
    const provider = await creerProvider()

    await provider.initier(requete({ operateur: 'ORANGE_CMR' }), SIGNAL())

    expect(faux.initiations[0]?.corps).toMatchObject({ provider: 'ORANGE_CMR', country: 'CMR' })
  })

  it.each(['+237 680 000 000', '+237680000000', '237 680 000 000'])('should send the phone without spaces nor "+" (%j)', async (saisie) => {
    const provider = await creerProvider()

    await provider.initier(requete({ telephoneInternational: saisie }), SIGNAL())

    expect(faux.initiations[0]?.corps?.phone).toBe(NUMERO)
  })

  it('should never put the API key or the phone number in the URL', async () => {
    const provider = await creerProvider()

    await provider.initier(requete(), SIGNAL())

    expect(faux.initiations[0]?.chemin).not.toContain(MERCY_TEST_CLE_API)
    expect(faux.initiations[0]?.chemin).not.toContain(NUMERO)
  })

  it('should build the same key and the byte-identical body for the same input, so that a replay is idempotent (spec §4.2)', async () => {
    const provider = await creerProvider()
    const req = requete()

    await provider.initier(req, SIGNAL())
    await provider.initier(req, SIGNAL())

    expect(faux.initiations).toHaveLength(2)
    expect(faux.initiations[1]?.entetes['idempotency-key']).toBe(faux.initiations[0]?.entetes['idempotency-key'])
    expect(faux.initiations[1]?.corpsBrut).toBe(faux.initiations[0]?.corpsBrut)
    expect(faux.rejeux()).toBe(1)
    expect(faux.paiements.size).toBe(1)
  })

  it.each([
    ['zero', 0],
    ['negative', -5000],
    ['a decimal', 5000.5],
    ['NaN', Number.NaN],
    ['beyond the safe integer range', Number.MAX_SAFE_INTEGER + 2],
  ])('should refuse before any call an amount that is %s', async (_libelle, montant) => {
    const provider = await creerProvider()

    const resultat = await provider.initier(requete({ montant }), SIGNAL())

    expect(resultat.issue).toBe('refuse')
    expect(faux.requetes).toHaveLength(0)
  })

  it('should not follow a redirect: the credentials never leave for another host', async () => {
    faux.definirInitiation({ type: 'http', status: 302, entetes: { Location: `${autreServeur.baseUrl}/payments` } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat.issue).toBe('incertain')
    expect(autreServeur.requetes).toHaveLength(0)
  })
})

describe('initier : issues (CA-M07)', () => {
  it('should return `accepte` with the pay_ identifier and the raw status on a 201', async () => {
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat).toMatchObject({ issue: 'accepte', idFournisseur: faux.dernierPaiement().id, statutFournisseur: 'pending' })
    expect(faux.dernierPaiement().id).toMatch(/^pay_/)
  })

  it('should return `incertain/DOUBLON` on 409 idempotency_key_in_use', async () => {
    faux.definirInitiation({ type: 'http', status: 409, corps: { error: { code: 'idempotency_key_in_use', message: 'en cours' } } })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'incertain', code: 'DOUBLON' })
  })

  it('should return `indisponible/AUTH` on 401 and never retry (a retry cannot fix a wrong key)', async () => {
    faux.accepterCle('mp_sandbox_une_autre_cle')
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'AUTH' })
    expect(faux.initiations).toHaveLength(0)
    expect(faux.requetes).toHaveLength(1)
  })

  it('should return `indisponible/LIMITE` with retryAfterS = 12 on 429 with Retry-After: 12', async () => {
    faux.definirInitiation({ type: 'http', status: 429, entetes: { 'Retry-After': '12' } })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'LIMITE', retryAfterS: 12 })
  })

  it.each([['absent', undefined], ['not a number', 'bientot'], ['zero', '0'], ['negative', '-3']])(
    'should return `indisponible/LIMITE` without retryAfterS when Retry-After is %s',
    async (_libelle, valeur) => {
      faux.definirInitiation({ type: 'http', status: 429, ...(valeur === undefined ? {} : { entetes: { 'Retry-After': valeur } }) })
      const provider = await creerProvider()

      expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'LIMITE' })
    },
  )

  it('should cap an absurd Retry-After at one hour (a hostile header cannot block the service)', async () => {
    faux.definirInitiation({ type: 'http', status: 429, entetes: { 'Retry-After': '99999999' } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat).toMatchObject({ issue: 'indisponible', code: 'LIMITE' })
    expect((resultat as { retryAfterS?: number }).retryAfterS).toBeLessThanOrEqual(3_600)
  })

  it('should return `refuse` on 422 (the provider rejected the request, nothing was created)', async () => {
    faux.definirInitiation({ type: 'http', status: 422, corps: { error: { code: 'invalid_phone_number', message: 'x' } } })
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat.issue).toBe('refuse')
  })

  it.each([500, 502, 503])('should return `indisponible/SERVEUR` on a %i', async (status) => {
    faux.definirInitiation({ type: 'http', status })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'indisponible', code: 'SERVEUR' })
  })

  it('should return `incertain/DELAI` when the call exceeds the delay, with a single request (no automatic retry)', async () => {
    faux.definirInitiation({ type: 'silence' })
    const provider = await creerProvider({ delaiInitiationMs: 150 })

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat).toEqual({ issue: 'incertain', code: 'DELAI' })
    expect(faux.initiations).toHaveLength(1)
  })

  it('should return `incertain/DELAI` when the caller aborts the signal', async () => {
    faux.definirInitiation({ type: 'silence' })
    const provider = await creerProvider()
    const controleur = new AbortController()
    setTimeout(() => controleur.abort(), 100)

    expect(await provider.initier(requete(), controleur.signal)).toEqual({ issue: 'incertain', code: 'DELAI' })
  })

  it('should return `incertain/RESEAU` when the connection is cut without an answer', async () => {
    faux.definirInitiation({ type: 'coupure' })
    const provider = await creerProvider()

    expect(await provider.initier(requete(), SIGNAL())).toEqual({ issue: 'incertain', code: 'RESEAU' })
  })

  it.each([
    ['a body that is not JSON', { type: 'json-invalide' as const }],
    ['a payment without id', { type: 'sans-id' as const }],
    ['an amount different from the one requested', { type: 'montant-different' as const, montant: 4000 }],
    ['a metadata.paiement_id different from ours', { type: 'metadata-differente' as const }],
  ])('should NOT attach a payment to ours when the 201 answer has %s (`incertain/RESEAU`)', async (_libelle, scenario) => {
    faux.definirInitiation(scenario)
    const provider = await creerProvider()

    const resultat = await provider.initier(requete(), SIGNAL())

    expect(resultat).toEqual({ issue: 'incertain', code: 'RESEAU' })
  })
})

describe('consulter : GET /payments/{id}', () => {
  async function paiementConnu(modifications: Parameters<FauxMercyPay['modifierPaiement']>[1] = {}) {
    const provider = await creerProvider()
    const req = requete()
    await provider.initier(req, SIGNAL())
    const connu = faux.dernierPaiement()
    faux.modifierPaiement(connu.id, modifications)
    return { provider, req, id: connu.id }
  }

  it('should map a succeeded payment with its real fees, net amount, currency and our payment id', async () => {
    const { provider, req, id } = await paiementConnu({ status: 'succeeded' })

    const etat = await provider.consulter(id, SIGNAL())

    expect(etat).toMatchObject({
      idFournisseur: id,
      statut: 'reussi',
      montant: 5000,
      devise: 'XAF',
      fraisReels: 175,
      netReel: 4825,
      codeEchec: null,
      externalId: req.externalId,
    })
    expect(faux.consultations[0]?.entetes.authorization).toBe(`Bearer ${MERCY_TEST_CLE_API}`)
    expect(faux.consultations[0]?.chemin).toBe(`${MERCY_CHEMIN_PAIEMENTS}/${id}`)
  })

  it('should map a pending payment to `en_attente`', async () => {
    const { provider, id } = await paiementConnu()

    expect((await provider.consulter(id, SIGNAL()))?.statut).toBe('en_attente')
  })

  it('should map a failed payment to `echoue` with the failure code upper-cased', async () => {
    const { provider, id } = await paiementConnu({ status: 'failed', failure_code: 'insufficient_balance' })

    expect(await provider.consulter(id, SIGNAL())).toMatchObject({ statut: 'echoue', codeEchec: 'INSUFFICIENT_BALANCE' })
  })

  it('should map a refunded payment to `rembourse`', async () => {
    const { provider, id } = await paiementConnu({ status: 'refunded' })

    expect((await provider.consulter(id, SIGNAL()))?.statut).toBe('rembourse')
  })

  it('should treat an unknown status as non terminal (`en_attente`): nothing is applied by mistake', async () => {
    const { provider, id } = await paiementConnu()
    faux.modifierPaiement(id, { status: 'statut_futur' as never })

    expect((await provider.consulter(id, SIGNAL()))?.statut).toBe('en_attente')
  })

  it('should return null for an unknown payment (404)', async () => {
    const provider = await creerProvider()

    expect(await provider.consulter('pay_inconnu', SIGNAL())).toBeNull()
  })

  it('should percent-encode the identifier so that it can never change the path', async () => {
    const provider = await creerProvider()

    await provider.consulter('../account', SIGNAL())

    expect(faux.consultations[0]?.chemin).toBe(`${MERCY_CHEMIN_PAIEMENTS}/..%2Faccount`)
  })

  it.each([
    ['401', { type: 'http' as const, status: 401 }, 'AUTH', null],
    ['429 with Retry-After: 12', { type: 'http' as const, status: 429, entetes: { 'Retry-After': '12' } }, 'LIMITE', 12],
    ['500', { type: 'http' as const, status: 500 }, 'SERVEUR', null],
  ])('should throw FournisseurIndisponibleError on %s', async (_libelle, scenario, code, retryAfterS) => {
    faux.definirConsultation(scenario)
    const provider = await creerProvider()

    await expect(provider.consulter('pay_x', SIGNAL())).rejects.toMatchObject({ name: 'FournisseurIndisponibleError', code, retryAfterS })
  })

  it('should throw FournisseurIndisponibleError(DELAI) when the provider does not answer in time', async () => {
    faux.definirConsultation({ type: 'silence' })
    const provider = await creerProvider({ delaiConsultationMs: 150 })

    await expect(provider.consulter('pay_x', SIGNAL())).rejects.toMatchObject({ name: 'FournisseurIndisponibleError', code: 'DELAI' })
  })

  it('should throw FournisseurIndisponibleError(RESEAU) for an answer that does not respect the contract', async () => {
    faux.definirConsultation({ type: 'http', status: 200, corps: { data: { id: 'pay_x', amount: 'beaucoup' } } })
    const provider = await creerProvider()

    await expect(provider.consulter('pay_x', SIGNAL())).rejects.toMatchObject({ name: 'FournisseurIndisponibleError', code: 'RESEAU' })
  })
})

describe('journaux et messages d’erreur : aucune donnée sensible', () => {
  it('should write neither the API key, the phone number nor a response body in any log, whatever the failure', async () => {
    const provider = await creerProvider({ delaiInitiationMs: 150 })
    for (const scenario of [
      { type: 'http' as const, status: 401, corps: { error: { code: 'invalid_api_key', message: `clé ${MERCY_TEST_CLE_API} refusée` } } },
      { type: 'http' as const, status: 500, corps: { error: { message: `numéro ${NUMERO}` } } },
      { type: 'silence' as const },
      { type: 'coupure' as const },
      { type: 'montant-different' as const, montant: 1 },
    ]) {
      faux.definirInitiation(scenario)
      await provider.initier(requete({ externalId: randomUUID() }), SIGNAL())
    }
    faux.definirConsultation({ type: 'http', status: 500, corps: { error: { message: `numéro ${NUMERO} ${MERCY_TEST_CLE_API}` } } })
    const erreur = await provider.consulter('pay_x', SIGNAL()).then(() => null, (e: unknown) => e as Error)

    const sortie = journaux?.contenu() ?? ''
    expect(sortie).not.toContain(MERCY_TEST_CLE_API)
    expect(sortie).not.toContain(NUMERO)
    expect(sortie).not.toContain(MERCY_TEST_SECRET_WEBHOOK)
    expect(erreur?.message ?? '').not.toContain(MERCY_TEST_CLE_API)
    expect(erreur?.message ?? '').not.toContain(NUMERO)
    expect(erreur?.message ?? '').not.toContain('127.0.0.1')
  })
})
