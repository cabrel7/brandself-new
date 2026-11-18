import { describe, expect, it } from 'vitest'
import { creerMercyPayProvider } from '../../server/services/paiements/fournisseurs/mercypay/adaptateur'
import { schemaMercyListePaiements, schemaMercyReponsePaiement } from '../../server/services/paiements/fournisseurs/mercypay/schemas'

// Contrat avec la DOCUMENTATION de Mercy Pay : les exemples ci-dessous sont recopiés tels quels des pages officielles
// (« Encaisser un paiement » : réponse 201 ; « Événements » : `payment.succeeded` ; « Lister les paiements »). Un faux serveur
// écrit d'après la seule spec ne détecte pas un format réel inattendu (revue P1 : `created` est une date ISO 8601, pas un
// entier). Si un de ces tests échoue, c'est notre schéma qui s'écarte de ce que Mercy envoie réellement.

const REPONSE_201_DOC = {
  data: {
    id: 'pay_5e0c8a7b3d1f4a2e9c648b7f0d2e1a93',
    object: 'payment',
    livemode: false,
    created: '2026-10-04T10:20:00+00:00',
    checkout_session: null,
    amount: 1000,
    fee_amount: 50,
    net_amount: 950,
    currency: 'XAF',
    payment_method: 'mobile_money',
    mobile_money_country: 'CMR',
    mobile_money_provider: 'MTN_MOMO_CMR',
    status: 'pending',
    failure_code: null,
    failure_reason: null,
    metadata: null,
    next_action: null,
  },
}

const EVENEMENT_SUCCES_DOC = {
  id: 'evt_01J9Z4K2M8TQ5VX3WB7NRY6HDA',
  object: 'event',
  type: 'payment.succeeded',
  created: '2026-10-03T10:20:00+00:00',
  livemode: true,
  data: {
    id: 'pay_5e0c8a7b3d1f4a2e9c648b7f0d2e1a93',
    object: 'payment',
    livemode: true,
    created: '2026-10-03T10:20:00+00:00',
    checkout_session: 'cs_01J9Z3V8QK4M2XW7R6TB5N0HYD',
    amount: 15000,
    fee_amount: 750,
    net_amount: 14250,
    currency: 'XAF',
    payment_method: 'mobile_money',
    mobile_money_country: 'CMR',
    mobile_money_provider: 'MTN_MOMO_CMR',
    status: 'succeeded',
    failure_code: null,
    failure_reason: null,
    metadata: null,
    next_action: null,
  },
}

const EVENEMENT_ECHEC_DOC = {
  ...EVENEMENT_SUCCES_DOC,
  id: 'evt_01J9Z4K2M8TQ5VX3WB7NRY6HDB',
  type: 'payment.failed',
  livemode: false,
  data: {
    ...EVENEMENT_SUCCES_DOC.data,
    livemode: false,
    status: 'failed',
    fee_amount: undefined,
    net_amount: undefined,
    failure_code: 'transaction_expired',
    failure_reason: 'Le payeur n’a pas confirmé à temps',
  },
}

const LISTE_DOC = {
  object: 'list',
  data: [REPONSE_201_DOC.data],
  has_more: false,
  next_cursor: null,
}

function provider() {
  return creerMercyPayProvider({ baseUrl: 'https://mercy-pay.com/api/v1', cleApi: 'mp_sandbox_test_cle_factice', environnement: 'test' })
}

describe('contrat avec la documentation Mercy Pay', () => {
  it('should accept the 201 answer of POST /payments as printed in the documentation (ISO 8601 `created`)', () => {
    expect(schemaMercyReponsePaiement.safeParse(REPONSE_201_DOC).success).toBe(true)
  })

  it('should accept the list of payments as printed in the documentation', () => {
    expect(schemaMercyListePaiements.safeParse(LISTE_DOC).success).toBe(true)
  })

  it('should interpret the documented payment.succeeded event (never null: the route would answer 503 and Mercy would disable the endpoint)', () => {
    const evenement = provider().interpreterWebhook(EVENEMENT_SUCCES_DOC)

    expect(evenement).not.toBeNull()
    expect(evenement).toMatchObject({
      evenement: 'payment.succeeded',
      idTransaction: 'pay_5e0c8a7b3d1f4a2e9c648b7f0d2e1a93',
      statut: 'reussi',
      montant: 15000,
      devise: 'XAF',
      fraisReels: 750,
      netReel: 14250,
      environnement: 'live',
    })
    expect(evenement?.horodatage?.toISOString()).toBe('2026-10-03T10:20:00.000Z')
  })

  it('should interpret a documented payment.failed event and map `transaction_expired` to EXPIRE', () => {
    const evenement = provider().interpreterWebhook(JSON.parse(JSON.stringify(EVENEMENT_ECHEC_DOC)))

    expect(evenement).toMatchObject({ statut: 'echoue', codeEchec: 'EXPIRE', environnement: 'test' })
  })

  it('should keep a non-payment event with a `data` that is not an object (webhook.test): « autre », never null', () => {
    const evenement = provider().interpreterWebhook({ id: 'evt_test_1', object: 'event', type: 'webhook.test', created: '2026-10-03T10:20:00+00:00', livemode: false, data: null })

    expect(evenement).toMatchObject({ statut: 'autre', idTransaction: 'evt_test_1' })
  })
})
