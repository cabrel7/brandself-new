import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { demarrerFauxMercyPay, hmacMercy, MERCY_CHEMIN_PAIEMENTS, MERCY_TEST_CLE_API, signerWebhookMercy } from '../support/faux-mercypay'
import type { FauxMercyPay } from '../support/faux-mercypay'

// Le faux Mercy Pay est la seule chose factice des tests de paiement : il doit lui-même respecter le protocole documenté
// (spec P1 §2). Sans ce garde-fou, un faux trop complaisant ferait passer un client faux. Ne dépend d'AUCUN code de production.

let faux: FauxMercyPay

beforeAll(async () => {
  faux = await demarrerFauxMercyPay()
})
afterAll(async () => {
  await faux.fermer()
})
beforeEach(() => {
  faux.reinitialiser()
})

const CORPS = JSON.stringify({ amount: 5000, currency: 'XAF', payment_method: 'mobile_money', country: 'CMR', provider: 'MTN_MOMO_CMR', phone: '237680000000', description: 'x', metadata: { paiement_id: 'p1' } })

function post(corps: string, entetes: Record<string, string> = {}) {
  return fetch(`${faux.baseUrl}/payments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${MERCY_TEST_CLE_API}`, ...entetes }, body: corps })
}

describe('faux Mercy Pay : authentification et idempotence', () => {
  it('should answer 401 without the Bearer key and 400 idempotency_key_missing without the key header', async () => {
    const sansAuth = await fetch(`${faux.baseUrl}/payments`, { method: 'POST', headers: { 'idempotency-key': 'k' }, body: CORPS })
    const sansCle = await post(CORPS)

    expect(sansAuth.status).toBe(401)
    expect(sansCle.status).toBe(400)
    expect(((await sansCle.json()) as { error: { code: string } }).error.code).toBe('idempotency_key_missing')
  })

  it('should answer 201 with the documented payment object, next_action null and no phone number', async () => {
    const reponse = await post(CORPS, { 'idempotency-key': 'k1' })
    const json = (await reponse.json()) as { data: Record<string, unknown> }

    expect(reponse.status).toBe(201)
    expect(json.data).toMatchObject({
      object: 'payment',
      livemode: false,
      checkout_session: null,
      amount: 5000,
      fee_amount: 175,
      net_amount: 4825,
      currency: 'XAF',
      payment_method: 'mobile_money',
      mobile_money_country: 'CMR',
      mobile_money_provider: 'MTN_MOMO_CMR',
      status: 'pending',
      failure_code: null,
      failure_reason: null,
      metadata: { paiement_id: 'p1' },
      next_action: null,
    })
    expect(String(json.data.id)).toMatch(/^pay_/)
    expect(JSON.stringify(json)).not.toContain('237680000000')
  })

  it('should replay the original answer with Idempotent-Replayed: true for the same key and the same body', async () => {
    const premiere = await post(CORPS, { 'idempotency-key': 'k1' })
    const seconde = await post(CORPS, { 'idempotency-key': 'k1' })

    expect(premiere.headers.get('idempotent-replayed')).toBeNull()
    expect(seconde.status).toBe(201)
    expect(seconde.headers.get('idempotent-replayed')).toBe('true')
    expect(await seconde.text()).toBe(await premiere.text())
    expect(faux.paiements.size).toBe(1)
  })

  it('should answer 409 idempotency_key_reused for the same key with another body', async () => {
    await post(CORPS, { 'idempotency-key': 'k1' })
    const autre = await post(CORPS.replace('5000', '6000'), { 'idempotency-key': 'k1' })

    expect(autre.status).toBe(409)
    expect(((await autre.json()) as { error: { code: string } }).error.code).toBe('idempotency_key_reused')
    expect(faux.paiements.size).toBe(1)
  })

  it('should answer 409 idempotency_key_in_use while the first request is still being handled', async () => {
    let relacher: () => void = () => undefined
    const bloque = new Promise<void>((resolve) => {
      relacher = resolve
    })
    faux.surInitiation(() => bloque)
    const premiere = post(CORPS, { 'idempotency-key': 'k1' })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const pendant = await post(CORPS, { 'idempotency-key': 'k1' })
    relacher()
    await premiere

    expect(pendant.status).toBe(409)
    expect(((await pendant.json()) as { error: { code: string } }).error.code).toBe('idempotency_key_in_use')
  })

  it('should serve GET /payments/{id}, 404 for an unknown one', async () => {
    const creee = (await (await post(CORPS, { 'idempotency-key': 'k1' })).json()) as { data: { id: string } }

    const connu = await fetch(`${faux.baseUrl}/payments/${creee.data.id}`, { headers: { authorization: `Bearer ${MERCY_TEST_CLE_API}` } })
    const inconnu = await fetch(`${faux.baseUrl}/payments/pay_nope`, { headers: { authorization: `Bearer ${MERCY_TEST_CLE_API}` } })

    expect(connu.status).toBe(200)
    expect(inconnu.status).toBe(404)
    expect(faux.consultations[0]?.chemin).toBe(`${MERCY_CHEMIN_PAIEMENTS}/${creee.data.id}`)
  })
})

describe('signature des webhooks fabriqués', () => {
  it('should produce t=<seconds>,v1=<hex> with one v1 per secret', () => {
    const valeur = signerWebhookMercy('{"a":1}', { t: 1_700_000_000, secretsSupplementaires: ['whsec_autre'] })

    expect(valeur).toBe(`t=1700000000,v1=${hmacMercy('whsec_autre', 1_700_000_000, '{"a":1}')},v1=${hmacMercy('whsec_test0123456789abcdefghijklmnopqrstuvwxyz', 1_700_000_000, '{"a":1}')}`)
    expect(valeur.split(',v1=')[1]).toMatch(/^[0-9a-f]{64}$/)
  })
})
