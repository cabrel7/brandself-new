import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { demarrerFauxKpay, corpsWebhook, KPAY_TEST_SECRET_WEBHOOK, NUMEROS_SANDBOX, signerWebhook } from '../support/faux-kpay'
import type { FauxKpay } from '../support/faux-kpay'
import { createHmac } from 'node:crypto'

// Le faux serveur K-PAY est l'outil de preuve de tous les tests de paiement : il doit lui-même respecter le protocole
// documenté (kpay_doc.md), sinon les tests prouveraient le contraire de la réalité.

let faux: FauxKpay

beforeAll(async () => {
  faux = await demarrerFauxKpay()
})

afterAll(async () => {
  await faux.fermer()
})

beforeEach(() => {
  faux.reinitialiser()
})

async function initier(corps: Record<string, unknown>, entetes: Record<string, string> = {}): Promise<Response> {
  return fetch(`${faux.url}/api/v1/payments/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'k', 'x-secret-key': 's', ...entetes },
    body: JSON.stringify(corps),
  })
}

const CORPS = { amount: 5000, provider: 'MTN_MOMO_CMR', phoneNumber: NUMEROS_SANDBOX.nonTerminal, externalId: 'ext-1', currency: 'XAF' }

describe('faux K-PAY : initiation', () => {
  it('should answer 201 with the PENDING status and record the raw request', async () => {
    const reponse = await initier(CORPS)

    expect(reponse.status).toBe(201)
    const json = (await reponse.json()) as Record<string, unknown>
    expect(json).toMatchObject({ status: 'PENDING', amount: 5000, externalId: 'ext-1', currency: 'XAF' })
    expect(typeof json.id).toBe('string')
    expect(faux.initiations).toHaveLength(1)
    expect(faux.initiations[0]?.corps).toEqual(CORPS)
    expect(faux.initiations[0]?.entetes['x-api-key']).toBe('k')
  })

  it('should never confirm a success at initiation time, even for the sandbox success number', async () => {
    faux.definirInitiation({ type: 'selon-numero' })

    const json = (await (await initier({ ...CORPS, phoneNumber: NUMEROS_SANDBOX.succes })).json()) as Record<string, unknown>

    expect(json.status).toBe('PENDING')
    expect(faux.derniereTransaction().status).toBe('COMPLETED')
  })

  it('should answer 409 for an externalId already used, like the real service', async () => {
    await initier(CORPS)

    expect((await initier(CORPS)).status).toBe(409)
  })

  it.each([
    [400, { status: 400 }],
    [401, { status: 401 }],
    [429, { status: 429, entetes: { 'retry-after': '30' } }],
    [500, { status: 500 }],
  ])('should answer %i when the scenario says so', async (statut, scenario) => {
    faux.definirInitiation({ type: 'http', ...scenario })

    const reponse = await initier(CORPS)

    expect(reponse.status).toBe(statut)
    if (statut === 429) expect(reponse.headers.get('retry-after')).toBe('30')
  })

  it('should answer a broken JSON body and a body without id on request', async () => {
    faux.definirInitiation({ type: 'json-invalide' })
    const casse = await initier(CORPS)
    faux.definirInitiation({ type: 'sans-id' })
    const sansId = (await (await initier({ ...CORPS, externalId: 'ext-2' })).json()) as Record<string, unknown>

    expect(casse.status).toBe(201)
    await expect(casse.json()).rejects.toThrow()
    expect(sansId.id).toBeUndefined()
  })

  it('should never answer in the silence scenario (the caller times out)', async () => {
    faux.definirInitiation({ type: 'silence' })

    await expect(fetch(`${faux.url}/api/v1/payments/init`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(200) })).rejects.toThrow()
    expect(faux.initiations).toHaveLength(1)
  })
})

describe('faux K-PAY : consultation', () => {
  it('should map the sandbox numbers to their documented outcome', async () => {
    faux.definirInitiation({ type: 'selon-numero' })
    const cas: Array<[string, string, string | null]> = [
      [NUMEROS_SANDBOX.succes, 'COMPLETED', null],
      [NUMEROS_SANDBOX.echecPlafond, 'FAILED', 'PAYER_LIMIT_REACHED'],
      [NUMEROS_SANDBOX.echecIntrouvable, 'FAILED', 'PAYER_NOT_FOUND'],
      [NUMEROS_SANDBOX.nonTerminal, 'SUBMITTED', null],
    ]

    for (const [numero, statut, raison] of cas) {
      const initiation = (await (await initier({ ...CORPS, phoneNumber: numero, externalId: `ext-${numero}` })).json()) as { id: string }
      const lecture = (await (await fetch(`${faux.url}/api/v1/payments/${initiation.id}`)).json()) as Record<string, unknown>
      expect(lecture.status).toBe(statut)
      expect(lecture.failureReason ?? null).toBe(raison)
    }
  })

  it('should expose fees and net amount on a completed transaction (5 %)', async () => {
    faux.definirInitiation({ type: 'selon-numero' })
    const initiation = (await (await initier({ ...CORPS, phoneNumber: NUMEROS_SANDBOX.succes })).json()) as { id: string }

    const lecture = (await (await fetch(`${faux.url}/api/v1/payments/${initiation.id}`)).json()) as Record<string, unknown>

    expect(lecture).toMatchObject({ status: 'COMPLETED', amount: 5000, feeAmount: 250, netAmount: 4750 })
  })

  it('should find a transaction by its reference and answer 404 for an unknown one', async () => {
    const initiation = (await (await initier(CORPS)).json()) as { id: string, reference: string }

    expect((await fetch(`${faux.url}/api/v1/payments/${initiation.reference}`)).status).toBe(200)
    expect((await fetch(`${faux.url}/api/v1/payments/inconnu`)).status).toBe(404)
  })

  it('should let a test change a transaction before a reconciliation', async () => {
    const initiation = (await (await initier(CORPS)).json()) as { id: string }

    faux.modifierTransaction(initiation.id, { status: 'COMPLETED', feeAmount: 250, netAmount: 4750 })

    const lecture = (await (await fetch(`${faux.url}/api/v1/payments/${initiation.id}`)).json()) as Record<string, unknown>
    expect(lecture.status).toBe('COMPLETED')
  })
})

describe('faux K-PAY : signature des webhooks', () => {
  it('should sign the raw bytes with HMAC-SHA256 hex, exactly as K-PAY documents', () => {
    const corps = corpsWebhook({ paymentId: 'tx_1', amount: 5000, externalId: 'ext-é' })

    expect(signerWebhook(corps)).toBe(createHmac('sha256', KPAY_TEST_SECRET_WEBHOOK).update(Buffer.from(corps, 'utf8')).digest('hex'))
    expect(signerWebhook(corps)).toMatch(/^[0-9a-f]{64}$/)
    expect(signerWebhook(corps, 'autre-secret-assez-long-xx')).not.toBe(signerWebhook(corps))
  })

  it('should build the documented webhook fields and nothing from the card flow', () => {
    const corps = JSON.parse(corpsWebhook({ paymentId: 'tx_1', amount: 5000, externalId: 'ext-1', reference: 'KPAY-1' })) as Record<string, unknown>

    expect(Object.keys(corps).sort()).toEqual(['amount', 'event', 'externalId', 'paymentId', 'reference', 'status', 'timestamp'])
    expect(corps).toMatchObject({ event: 'payment.completed', status: 'COMPLETED', amount: 5000 })
  })
})
