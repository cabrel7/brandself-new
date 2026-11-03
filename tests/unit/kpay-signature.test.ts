import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { corpsWebhook, KPAY_TEST_SECRET_WEBHOOK } from '../support/faux-kpay'
import { moduleKpay } from './support/s10'

// S10 §6 CA23 et CA24 : vérification de la signature des webhooks et interprétation du corps.
// Signature = HMAC-SHA256 hexadécimal du CORPS BRUT (octets), comparaison en temps constant. En-tête `x-kpay-signature`.

const SECRET = KPAY_TEST_SECRET_WEBHOOK
const CORPS = Buffer.from(corpsWebhook({ paymentId: 'tx_1', externalId: 'ext-1', amount: 5000 }), 'utf8')

function hmac(corps: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(corps).digest('hex')
}

async function provider(secretWebhook: string | null = SECRET) {
  const { creerKpayProvider } = await moduleKpay()
  return creerKpayProvider({
    baseUrl: 'http://127.0.0.1:9',
    cleApi: 'kpay_test_0123456789abcdefghijklmn',
    cleSecrete: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    environnement: 'test',
    ...(secretWebhook === null ? {} : { secretWebhook }),
  })
}

describe('verifierSignature (CA23)', () => {
  it('should accept the HMAC computed independently on the same raw bytes', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(CORPS) })).toBe(true)
  })

  it('should accept an uppercase hexadecimal signature', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(CORPS).toUpperCase() })).toBe(true)
  })

  it('should refuse a body modified by a single byte', async () => {
    const p = await provider()
    const modifie = Buffer.from(CORPS)
    modifie[modifie.length - 3] = (modifie[modifie.length - 3] ?? 0) ^ 1

    expect(p.verifierSignature(modifie, { 'x-kpay-signature': hmac(CORPS) })).toBe(false)
  })

  it('should refuse a signature computed on a re-serialised body (spaces, key order)', async () => {
    const p = await provider()
    const reserialise = Buffer.from(JSON.stringify(JSON.parse(CORPS.toString('utf8')), null, 2))

    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(reserialise) })).toBe(false)
  })

  it('should refuse a signature made with another secret', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(CORPS, 'un-autre-secret-de-webhook-long') })).toBe(false)
  })

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['128 characters (hex of the hex)', Buffer.from('a'.repeat(64)).toString('hex')],
    ['not hexadecimal', 'z'.repeat(64)],
    ['with a prefix', `sha256=${'a'.repeat(64)}`],
    ['with surrounding spaces', ` ${'a'.repeat(64)} `],
  ])('should answer false without throwing for a signature header %s', async (_libelle, valeur) => {
    const p = await provider()

    expect(() => p.verifierSignature(CORPS, { 'x-kpay-signature': valeur })).not.toThrow()
    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': valeur })).toBe(false)
  })

  it('should answer false when the header is missing altogether', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, {})).toBe(false)
  })

  it('should answer false for every signature when no webhook secret is configured (never "true" on an empty key)', async () => {
    const p = await provider(null)

    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(CORPS, '') })).toBe(false)
    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(CORPS) })).toBe(false)
    expect(p.webhookConfigure).toBe(false)
  })

  it('should verify multi-byte UTF-8 on the raw bytes, not on a decoded string', async () => {
    const p = await provider()
    const corps = Buffer.from(JSON.stringify({ event: 'payment.completed', note: 'é — 日本' }), 'utf8')

    expect(p.verifierSignature(corps, { 'x-kpay-signature': hmac(corps) })).toBe(true)
    // Même texte décodé en latin1 puis ré-encodé : octets différents, signature différente.
    expect(p.verifierSignature(Buffer.from(corps.toString('latin1'), 'utf8'), { 'x-kpay-signature': hmac(corps) })).toBe(false)
  })

  it('should read the header whatever its case but refuse a repeated header (ambiguous)', async () => {
    const p = await provider()

    expect(p.verifierSignature(CORPS, { 'X-KPAY-Signature': hmac(CORPS) })).toBe(true)
    expect(p.verifierSignature(CORPS, { 'x-kpay-signature': hmac(CORPS), 'X-KPAY-SIGNATURE': hmac(CORPS) })).toBe(false)
  })
})

describe('interpreterWebhook (CA24)', () => {
  const brut = (surcharges: Record<string, unknown> = {}) => ({
    event: 'payment.completed',
    paymentId: 'tx_1',
    reference: 'KPAY-1',
    status: 'COMPLETED',
    amount: 5000,
    externalId: 'ext-1',
    timestamp: '2026-11-03T13:00:00.000Z',
    ...surcharges,
  })

  it('should normalise payment.completed + COMPLETED to a success', async () => {
    const p = await provider()

    expect(p.interpreterWebhook(brut())).toMatchObject({
      evenement: 'payment.completed',
      idTransaction: 'tx_1',
      externalId: 'ext-1',
      statut: 'reussi',
      montant: 5000,
      devise: null,
      referenceFournisseur: 'KPAY-1',
    })
  })

  it('should normalise failed and cancelled events and keep a well formed failure code', async () => {
    const p = await provider()

    expect(p.interpreterWebhook(brut({ event: 'payment.failed', status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' }))).toMatchObject({ statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND' })
    expect(p.interpreterWebhook(brut({ event: 'payment.cancelled', status: 'CANCELLED' }))).toMatchObject({ statut: 'annule' })
  })

  it.each(['payout.completed', 'payout.failed', 'refund.completed', 'refund.failed'])('should classify %s as "autre" (never a payment result)', async (evenement) => {
    const p = await provider()

    expect(p.interpreterWebhook(brut({ event: evenement }))?.statut).toBe('autre')
  })

  it('should classify a contradictory event/status pair as "autre" (completed event carrying FAILED)', async () => {
    const p = await provider()

    expect(p.interpreterWebhook(brut({ event: 'payment.completed', status: 'FAILED' }))?.statut).toBe('autre')
    expect(p.interpreterWebhook(brut({ event: 'payment.failed', status: 'COMPLETED' }))?.statut).toBe('autre')
  })

  it.each([
    ['an amount sent as a string', { amount: '5000' }],
    ['a missing paymentId', { paymentId: undefined }],
    ['an empty paymentId', { paymentId: '' }],
    ['a missing event', { event: undefined }],
    ['a missing status', { status: undefined }],
    ['a negative amount', { amount: -1 }],
    ['a null amount', { amount: null }],
    ['a paymentId of 101 characters', { paymentId: 'x'.repeat(101) }],
  ])('should answer null for %s', async (_libelle, surcharges) => {
    const p = await provider()

    expect(p.interpreterWebhook(brut(surcharges))).toBeNull()
  })

  it.each([null, 'texte', 42, [], [brut()]])('should answer null for a non object body (%j)', async (corps) => {
    const p = await provider()

    expect(p.interpreterWebhook(corps)).toBeNull()
  })

  it('should ignore unknown fields and never re-emit them', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(brut({ phoneNumber: '237653456789', secret: 'x', __proto__: { admin: true } }))

    expect(JSON.stringify(evt)).not.toContain('237653456789')
    expect(JSON.stringify(evt)).not.toContain('secret')
    expect(evt).not.toHaveProperty('admin')
  })

  it('should not round a non integer amount silently (it must stay different from the integer price)', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(brut({ amount: 4999.6 }))

    expect(evt === null || evt.montant !== 5000).toBe(true)
  })

  it('should keep a free text failure reason out of the failure code', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(brut({ event: 'payment.failed', status: 'FAILED', failureReason: 'Le client 237653456789 a refusé' }))

    expect(evt?.codeEchec ?? null).toBeNull()
  })
})
