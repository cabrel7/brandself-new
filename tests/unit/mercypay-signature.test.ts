import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  corpsPaiementMercy,
  hmacMercy,
  MERCY_ENTETE_SIGNATURE,
  MERCY_TEST_AUTRE_SECRET,
  MERCY_TEST_CLE_API,
  MERCY_TEST_SECRET_WEBHOOK,
  MERCY_TOLERANCE_SIGNATURE_S,
  signerWebhookMercy,
} from '../support/faux-mercypay'

const moduleMercyPay = () => import('../../server/services/paiements/fournisseurs/mercypay/adaptateur')

// P1 CA-M01, CA-M02, CA-M03 : signature des webhooks Mercy Pay. En-tête `MercyPay-Signature: t=<secondes>,v1=<hex>[,v1=<hex>…]`,
// HMAC-SHA256 de "{t}.{corps brut}" avec le secret `whsec_…`, tolérance 300 s, plusieurs `v1` pendant une rotation de secret.
// Le calcul de référence est fait ICI, indépendamment du code de production (support/faux-mercypay.ts).

const MAINTENANT = new Date('2026-11-18T10:00:00.000Z')
const T_MAINTENANT = Math.floor(MAINTENANT.getTime() / 1000)
const CORPS = Buffer.from(corpsPaiementMercy({ paymentId: 'pay_x', paiementId: '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10', amount: 5000 }), 'utf8')

async function provider(secretWebhook: string | null = MERCY_TEST_SECRET_WEBHOOK) {
  const { creerMercyPayProvider } = await moduleMercyPay()
  return creerMercyPayProvider({
    baseUrl: 'http://127.0.0.1:9/api/v1',
    cleApi: MERCY_TEST_CLE_API,
    environnement: 'test',
    ...(secretWebhook === null ? {} : { secretWebhook }),
  })
}

const entete = (valeur: string) => ({ [MERCY_ENTETE_SIGNATURE]: valeur })

describe('verifierSignature : signature valide (CA-M01)', () => {
  it('should accept the header t=<now>,v1=HMAC("t.body") computed independently on the raw bytes', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT })), MAINTENANT)).toBe(true)
  })

  it('should accept the header whatever the case of its name', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, { 'MercyPay-Signature': signerWebhookMercy(CORPS, { t: T_MAINTENANT }) }, MAINTENANT)).toBe(true)
  })

  it('should verify a body containing multi-byte UTF-8 on its raw bytes', async () => {
    const p = await provider()
    const corps = Buffer.from('{"id":"evt_1","type":"webhook.test","livemode":false,"data":{"note":"é — 日本 ✓"}}', 'utf8')

    expect(p.verifierSignature(corps, entete(signerWebhookMercy(corps, { t: T_MAINTENANT })), MAINTENANT)).toBe(true)
  })

  it('should refuse a body modified by a single byte', async () => {
    const p = await provider()
    const modifie = Buffer.from(CORPS)
    modifie[modifie.length - 3] = (modifie[modifie.length - 3] ?? 0) ^ 1

    expect(p.verifierSignature(modifie, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT })), MAINTENANT)).toBe(false)
  })

  it('should refuse a signature computed on a re-serialised body (one space added)', async () => {
    const p = await provider()
    const reserialise = Buffer.from(CORPS.toString('utf8').replace('{"id"', '{ "id"'), 'utf8')

    expect(p.verifierSignature(reserialise, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT })), MAINTENANT)).toBe(false)
  })

  it('should refuse a signature computed over the body alone, without the "t." prefix', async () => {
    const p = await provider()
    const sansHorodatage = `t=${T_MAINTENANT},v1=${createHmac('sha256', MERCY_TEST_SECRET_WEBHOOK).update(CORPS).digest('hex')}`

    expect(p.verifierSignature(CORPS, entete(sansHorodatage), MAINTENANT)).toBe(false)
  })

  it('should refuse a signature whose t was altered after signing (the timestamp is signed)', async () => {
    const p = await provider()
    const v1 = hmacMercy(MERCY_TEST_SECRET_WEBHOOK, T_MAINTENANT - 100, CORPS)

    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v1=${v1}`), MAINTENANT)).toBe(false)
  })

  it('should refuse a signature made with another secret', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT, secret: MERCY_TEST_AUTRE_SECRET })), MAINTENANT)).toBe(false)
  })

  it('should refuse everything when no webhook secret is configured, even a signature made with an empty secret', async () => {
    const p = await provider(null)

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT })), MAINTENANT)).toBe(false)
    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT, secret: '' })), MAINTENANT)).toBe(false)
  })
})

describe('verifierSignature : tolérance de 300 secondes (CA-M02)', () => {
  it('should state the documented tolerance of 300 seconds', () => {
    expect(MERCY_TOLERANCE_SIGNATURE_S).toBe(300)
  })

  it('should refuse t = now - 301 s', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT - 301 })), MAINTENANT)).toBe(false)
  })

  it('should accept t = now - 299 s', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT - 299 })), MAINTENANT)).toBe(true)
  })

  it('should also refuse a timestamp too far in the FUTURE (t = now + 301 s) and accept now + 299 s', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT + 301 })), MAINTENANT)).toBe(false)
    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT + 299 })), MAINTENANT)).toBe(true)
  })

  it('should use the INJECTED clock, not the system clock (same header, two instants)', async () => {
    const p = await provider()
    const valeur = signerWebhookMercy(CORPS, { t: T_MAINTENANT })

    expect(p.verifierSignature(CORPS, entete(valeur), new Date(MAINTENANT.getTime() + 299_000))).toBe(true)
    expect(p.verifierSignature(CORPS, entete(valeur), new Date(MAINTENANT.getTime() + 600_000))).toBe(false)
  })

  it('should refuse a replayed old webhook (valid signature, t one day old)', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, entete(signerWebhookMercy(CORPS, { t: T_MAINTENANT - 86_400 })), MAINTENANT)).toBe(false)
  })
})

describe('verifierSignature : plusieurs v1 et en-têtes malformés (CA-M03)', () => {
  it('should accept two v1 when only ONE is computed with our secret, in either order', async () => {
    const p = await provider()
    const avecAutreAvant = signerWebhookMercy(CORPS, { t: T_MAINTENANT, secretsSupplementaires: [MERCY_TEST_AUTRE_SECRET] })
    const v1Nous = hmacMercy(MERCY_TEST_SECRET_WEBHOOK, T_MAINTENANT, CORPS)
    const v1Autre = hmacMercy(MERCY_TEST_AUTRE_SECRET, T_MAINTENANT, CORPS)

    expect(p.verifierSignature(CORPS, entete(avecAutreAvant), MAINTENANT)).toBe(true)
    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v1=${v1Nous},v1=${v1Autre}`), MAINTENANT)).toBe(true)
  })

  it('should refuse when NO v1 matches our secret', async () => {
    const p = await provider()
    const v1A = hmacMercy(MERCY_TEST_AUTRE_SECRET, T_MAINTENANT, CORPS)
    const v1B = hmacMercy('whsec_encore-un-autre-secret-assez-long', T_MAINTENANT, CORPS)

    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v1=${v1A},v1=${v1B}`), MAINTENANT)).toBe(false)
  })

  it.each([
    ['too short', 'abc'],
    ['one byte short', 'a'.repeat(63)],
    ['one byte too long', 'a'.repeat(65)],
    ['empty', ''],
    ['not hexadecimal', 'z'.repeat(64)],
  ])('should answer false WITHOUT throwing for a v1 %s (constant-time comparison needs equal lengths)', async (_libelle, v1) => {
    const p = await provider()

    expect(() => p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v1=${v1}`), MAINTENANT)).not.toThrow()
    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v1=${v1}`), MAINTENANT)).toBe(false)
  })

  it('should not let a malformed v1 hide a valid one', async () => {
    const p = await provider()
    const v1Nous = hmacMercy(MERCY_TEST_SECRET_WEBHOOK, T_MAINTENANT, CORPS)

    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v1=abc,v1=${v1Nous}`), MAINTENANT)).toBe(true)
  })

  it.each([
    ['absent header', undefined],
    ['empty header', ''],
    ['garbage', 'pas-une-signature'],
    ['no t', `v1=${'a'.repeat(64)}`],
    ['no v1', `t=${T_MAINTENANT}`],
    ['t not a number', `t=abc,v1=${'a'.repeat(64)}`],
    ['t empty', `t=,v1=${'a'.repeat(64)}`],
    ['negative t', `t=-1,v1=${'a'.repeat(64)}`],
    ['fractional t', `t=${T_MAINTENANT}.5,v1=${'a'.repeat(64)}`],
    ['huge t', `t=${'9'.repeat(40)},v1=${'a'.repeat(64)}`],
  ])('should answer false WITHOUT throwing for %s', async (_libelle, valeur) => {
    const p = await provider()
    const entetes = valeur === undefined ? {} : entete(valeur)

    expect(() => p.verifierSignature(CORPS, entetes, MAINTENANT)).not.toThrow()
    expect(p.verifierSignature(CORPS, entetes, MAINTENANT)).toBe(false)
  })

  it('should ignore an unknown scheme (v0, v2) even when its value is the right HMAC', async () => {
    const p = await provider()
    const bon = hmacMercy(MERCY_TEST_SECRET_WEBHOOK, T_MAINTENANT, CORPS)

    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v0=${bon}`), MAINTENANT)).toBe(false)
    expect(p.verifierSignature(CORPS, entete(`t=${T_MAINTENANT},v2=${bon}`), MAINTENANT)).toBe(false)
  })

  it('should treat a repeated header (ambiguous signature) as absent', async () => {
    const p = await provider()

    // Un en-tête répété est aplati en `undefined` par `aplatirEntetes` : la vérification doit alors refuser.
    expect(p.verifierSignature(CORPS, { [MERCY_ENTETE_SIGNATURE]: undefined }, MAINTENANT)).toBe(false)
  })
})
