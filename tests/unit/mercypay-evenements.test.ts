import { describe, expect, it } from 'vitest'
import { CODE_ECHEC_DEFAUT, CODE_ECHEC_EXPIRE, messageEchec, MESSAGES_ECHEC } from '../../shared/paiements'
import { corpsEvenementMercy, corpsPaiementMercy, MERCY_TEST_CLE_API, MERCY_TEST_CLE_LIVE, MERCY_TEST_SECRET_WEBHOOK } from '../support/faux-mercypay'

// P1 §4.1, §4.2 et CA-M10 (mappage des codes d'échec), CA-M11 (événements hors paiement), CA-M13 (livemode) : interprétation d'un
// webhook Mercy Pay par l'adaptateur. `interpreterWebhook` ne renvoie `null` QUE pour un schéma invalide ; tout type non géré donne
// `statut: 'autre'` (journalisé `ignore`, réponse 200 : Mercy désactive l'endpoint après des échecs persistants).

const moduleMercyPay = () => import('../../server/services/paiements/fournisseurs/mercypay/adaptateur')
const PAIEMENT_ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

async function provider(cleApi: string = MERCY_TEST_CLE_API) {
  const { creerMercyPayProvider } = await moduleMercyPay()
  return creerMercyPayProvider({ baseUrl: 'http://127.0.0.1:9/api/v1', cleApi, environnement: cleApi.startsWith('mp_live_') ? 'live' : 'test', secretWebhook: MERCY_TEST_SECRET_WEBHOOK })
}

const lire = (corps: string): unknown => JSON.parse(corps) as unknown

describe('interpreterWebhook : payment.succeeded', () => {
  it('should normalise a success with our payment id (metadata.paiement_id), amounts, real fees and the environment', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({ paymentId: 'pay_x', paiementId: PAIEMENT_ID, amount: 5000, feeAmount: 175, netAmount: 4825 })))

    expect(evt).toMatchObject({
      evenement: 'payment.succeeded',
      idTransaction: 'pay_x',
      externalId: PAIEMENT_ID,
      statut: 'reussi',
      montant: 5000,
      devise: 'XAF',
      fraisReels: 175,
      netReel: 4825,
      codeEchec: null,
      environnement: 'test',
    })
  })

  it('should report livemode true as the `live` environment', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({ paymentId: 'pay_x', paiementId: PAIEMENT_ID, amount: 5000, livemode: true })))

    expect(evt?.environnement).toBe('live')
  })

  it('should give a null external id when the metadata does not carry our payment id (the application will find it by pay_ id)', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({ paymentId: 'pay_x', paiementId: null, amount: 5000 })))

    expect(evt).toMatchObject({ statut: 'reussi', externalId: null })
  })

  it('should ignore fields unknown to the contract, in the envelope and in data', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({
      paymentId: 'pay_x',
      paiementId: PAIEMENT_ID,
      amount: 5000,
      extra: { champ_futur: 1, created: 1_700_000_000 },
      dataExtra: { customer: { email: 'a@b.cm' }, autre: [1, 2] },
    })))

    expect(evt).toMatchObject({ statut: 'reussi', idTransaction: 'pay_x' })
  })

  it('should NOT treat a contradictory event as a success (type succeeded with status failed -> `autre`)', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({ type: 'payment.succeeded', status: 'failed', paymentId: 'pay_x', paiementId: PAIEMENT_ID, amount: 5000 })))

    expect(evt?.statut).toBe('autre')
  })
})

describe('interpreterWebhook : payment.failed et codes d’échec (CA-M10)', () => {
  it.each([
    ['insufficient_balance', 'INSUFFICIENT_BALANCE'],
    ['payment_not_approved', 'PAYMENT_NOT_APPROVED'],
    // Code réel de la documentation (« Le payeur n'a pas confirmé à temps ») ; `expired` est le statut d'un paiement carte.
    ['transaction_expired', CODE_ECHEC_EXPIRE],
    ['expired', CODE_ECHEC_EXPIRE],
    ['amount_out_of_bounds', 'AMOUNT_OUT_OF_BOUNDS'],
  ])('should map the Mercy failure code %j to our code %j', async (codeMercy, attendu) => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({ type: 'payment.failed', paymentId: 'pay_x', paiementId: PAIEMENT_ID, amount: 5000, failureCode: codeMercy })))

    expect(evt).toMatchObject({ evenement: 'payment.failed', statut: 'echoue', codeEchec: attendu })
    expect(messageEchec(evt?.codeEchec ?? null)).toBe(MESSAGES_ECHEC[attendu])
  })

  it.each([
    ['an unknown code', 'code_jamais_vu'],
    ['a missing code', null],
    ['an hostile code (__proto__)', '__proto__'],
    ['an oversized code', 'x'.repeat(500)],
    ['a code with spaces and markup', '<script>alert(1)</script>'],
  ])('should fall back to the DEFAUT message for %s, never relaying the provider text', async (_libelle, code) => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({
      type: 'payment.failed',
      paymentId: 'pay_x',
      paiementId: PAIEMENT_ID,
      amount: 5000,
      failureCode: code,
      failureReason: 'Texte brut de Mercy qui ne doit jamais atteindre l’utilisateur',
    })))

    expect(evt?.statut).toBe('echoue')
    expect(messageEchec(evt?.codeEchec ?? null)).toBe(MESSAGES_ECHEC[CODE_ECHEC_DEFAUT])
    expect(JSON.stringify(evt)).not.toContain('Texte brut de Mercy')
  })
})

describe('interpreterWebhook : événements hors succès et hors paiement (CA-M11)', () => {
  it('should map payment.refunded to `rembourse`', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsPaiementMercy({ type: 'payment.refunded', paymentId: 'pay_x', paiementId: PAIEMENT_ID, amount: 5000 })))

    expect(evt).toMatchObject({ evenement: 'payment.refunded', statut: 'rembourse' })
  })

  it.each([
    ['webhook.test', {}],
    ['account.updated', { id: 'acct_1', object: 'account', charges_enabled: true }],
    ['provider_status.changed', { provider: 'MTN_MOMO_CMR', status: 'degraded' }],
    ['payout.paid', { id: 'po_1', amount: 1 }],
  ])('should normalise %s as `autre`, never as null (null would make the route answer 503 and Mercy disable the endpoint)', async (type, data) => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsEvenementMercy({ id: 'evt_abc123', type, data })))

    expect(evt).not.toBeNull()
    expect(evt).toMatchObject({ evenement: type, statut: 'autre' })
  })

  it('should identify a non-payment event by its evt_ id (no pay_ id exists)', async () => {
    const p = await provider()

    const evt = p.interpreterWebhook(lire(corpsEvenementMercy({ id: 'evt_abc123', type: 'webhook.test', data: {} })))

    expect(evt?.idTransaction).toBe('evt_abc123')
  })

  it('should keep the live/test environment of a non-payment event too', async () => {
    const p = await provider(MERCY_TEST_CLE_LIVE)

    const evt = p.interpreterWebhook(lire(corpsEvenementMercy({ type: 'webhook.test', livemode: true, data: {} })))

    expect(evt?.environnement).toBe('live')
  })
})

describe('interpreterWebhook : schéma invalide -> null (le seul cas)', () => {
  it.each([
    ['null', null],
    ['an array', [1, 2, 3]],
    ['a string', 'payment.succeeded'],
    ['an empty object', {}],
    ['an event without type', { id: 'evt_1', livemode: false, data: {} }],
    ['an event without id', { type: 'webhook.test', livemode: false, data: {} }],
    ['an event without data', { id: 'evt_1', type: 'webhook.test', livemode: false }],
    ['a livemode that is not a boolean', { id: 'evt_1', type: 'webhook.test', livemode: 'false', data: {} }],
  ])('should return null for %s', async (_libelle, corps) => {
    const p = await provider()

    expect(p.interpreterWebhook(corps)).toBeNull()
  })

  it.each([
    ['an amount sent as a string', { amount: '5000' }],
    ['a decimal amount', { amount: 5000.5 }],
    ['a negative amount', { amount: -1 }],
    ['a payment id that is not a string', { id: 42 }],
  ])('should return null for a payment.succeeded with %s', async (_libelle, surcharge) => {
    const p = await provider()
    const brut = lire(corpsPaiementMercy({ paymentId: 'pay_x', paiementId: PAIEMENT_ID, amount: 5000 })) as { data: Record<string, unknown> }

    expect(p.interpreterWebhook({ ...brut, data: { ...brut.data, ...surcharge } })).toBeNull()
  })
})
