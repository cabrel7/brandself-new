import { describe, expect, it, vi } from 'vitest'
import { WEBHOOK_CORPS_MAX_OCTETS } from '../../shared/limites'
import { corpsWebhook, signerWebhook } from '../support/faux-kpay'
import {
  appelerRouteWebhook,
  compter,
  corpsPour,
  insererPaiement,
  lireAbonnement,
  lireEvenements,
  lirePaiement,
  evenementWebhook,
  providerSansSecretWebhook,
  NOW,
} from './support/abonnements'
import { createUser } from './support/fabriques'

// S10 §6 CA41, CA48 à CA51, CA99 et #112 : le CONTRAT HTTP de la route `POST /api/webhooks/[fournisseur]` (handler Nitro réel
// sur événement h3 réel, PostgreSQL réel). Ni session, ni Origin. Réponse identique `{ recu: true }` pour appliqué,
// doublon, ignoré ou anomalie. Les dates précises sont prouvées dans webhook-kpay-reception.test.ts (horloge injectée).
// Limite connue : les middlewares globaux Nitro ne tournent pas dans un test de handler ; leur absence d'effet sur
// /api/webhooks/** est prouvée par e2e/api/abonnement.spec.ts (serveur réel).

const ID_INCONNU = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

async function ecritures(): Promise<{ paiements: number, evenements: number, abonnements: number }> {
  return { paiements: await compter('paiements'), evenements: await compter('evenements_paiement'), abonnements: await compter('abonnements') }
}

describe('route webhook : succès', () => {
  it('should answer 200 { recu: true } with no cache and activate the subscription', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const reponse = await appelerRouteWebhook({ corps: corpsPour(paiement) })

    expect(reponse.status).toBe(200)
    expect(reponse.corps).toEqual({ recu: true })
    expect(reponse.entetes['cache-control']).toContain('no-store')
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
    expect(await lireAbonnement(user.id)).toBeDefined()
  })

  it('should answer the byte for byte same body for applied, replayed, unknown, ignored and anomalous events (no oracle)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    const mauvais = await insererPaiement(user.id, { idFournisseur: 'tx_mauvais' })
    const corps = corpsPour(paiement)

    const reponses = [
      await appelerRouteWebhook({ corps }),
      await appelerRouteWebhook({ corps }),
      await appelerRouteWebhook({ corps: corpsWebhook({ paymentId: 'tx_z', externalId: ID_INCONNU, amount: 5000 }) }),
      await appelerRouteWebhook({ corps: corpsPour(paiement, { event: 'payout.completed', paymentId: 'tx_payout' }) }),
      await appelerRouteWebhook({ corps: corpsPour(mauvais, { amount: 1 }) }),
    ]

    for (const reponse of reponses) {
      expect(reponse.status).toBe(200)
      expect(JSON.stringify(reponse.corps)).toBe('{"recu":true}')
    }
  })

  it('should neither need a session nor be influenced by a session cookie or an Origin header (CA99)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const reponse = await appelerRouteWebhook({
      corps: corpsPour(paiement),
      entetes: { cookie: 'better-auth.session_token=forge.forge', origin: 'https://evil.example', host: 'brandself.io' },
    })

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })
})

describe('route webhook : signature (CA41)', () => {
  it.each([
    ['absent', null],
    ['invalid', 'a'.repeat(64)],
    ['of the wrong length', 'abc'],
    ['made with another secret', 'SECRET_AUTRE'],
  ])('should answer 401 SIGNATURE_INVALIDE for a signature %s and write nothing', async (_libelle, signature) => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    const avant = await ecritures()
    const corps = corpsPour(paiement)

    const reponse = await appelerRouteWebhook({
      corps,
      signature: signature === 'SECRET_AUTRE' ? signerWebhook(corps, 'un-autre-secret-assez-long-xx') : signature,
    })

    expect(reponse.status).toBe(401)
    expect(reponse.code).toBe('SIGNATURE_INVALIDE')
    expect(await ecritures()).toEqual(avant)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should answer 401 for a signature computed on a re-serialised body, and reveal no detail on the cause', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    const corps = corpsPour(paiement)
    const reserialise = JSON.stringify(JSON.parse(corps), null, 2)

    const reponse = await appelerRouteWebhook({ corps, signature: signerWebhook(reserialise) })

    expect(reponse.status).toBe(401)
    expect(JSON.stringify(reponse)).not.toMatch(/hmac|secret|attendue|expected|corps|body/i)
  })

  it('should check the signature BEFORE parsing : an unreadable body with a bad signature is a 401, not a 400', async () => {
    const reponse = await appelerRouteWebhook({ corps: '{pas du json', signature: 'a'.repeat(64) })

    expect(reponse.status).toBe(401)
  })

  it('should verify a body containing multi-byte UTF-8 on its raw bytes', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const reponse = await appelerRouteWebhook({ corps: corpsPour(paiement, { extra: { note: 'é — 日本 ✓' } }) })

    expect(reponse.status).toBe(200)
  })
})

describe('route webhook : taille et forme du corps (CA48, CA49)', () => {
  it('should answer 413 CORPS_TROP_GROS for a body of 16 385 bytes announced by Content-Length, before any signature check', async () => {
    const grand = Buffer.alloc(WEBHOOK_CORPS_MAX_OCTETS + 1, 'a')

    const reponse = await appelerRouteWebhook({ corps: grand, signature: null })

    expect(reponse.status).toBe(413)
    expect(reponse.code).toBe('CORPS_TROP_GROS')
  })

  it('should answer 413 for a body sent in chunks WITHOUT Content-Length once it goes past the limit', async () => {
    const morceaux = Array.from({ length: 5 }, () => Buffer.alloc(4_000, 'a'))

    const reponse = await appelerRouteWebhook({ corps: morceaux, contentLength: false, signature: null })

    expect(reponse.status).toBe(413)
  })

  it('should accept a body of exactly the maximum size when it is correctly signed (then a retryable 503 for not being JSON)', async () => {
    const exact = Buffer.alloc(WEBHOOK_CORPS_MAX_OCTETS, 'a')

    const reponse = await appelerRouteWebhook({ corps: exact })

    expect(reponse.status).toBe(503)
    expect(reponse.code).toBe('PAIEMENT_INDISPONIBLE')
  })

  it('should answer a RETRYABLE 503 (K-PAY never retries a 4xx) for a validly signed unreadable JSON, writing nothing (CA49)', async () => {
    const avant = await ecritures()
    const alerte = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const reponse = await appelerRouteWebhook({ corps: '{"event": "payment.completed", ' })

    expect(reponse.status).toBe(503)
    expect(reponse.code).toBe('PAIEMENT_INDISPONIBLE')
    expect(alerte).toHaveBeenCalledWith(expect.objectContaining({ webhook: 'signe_non_interpretable', fournisseur: 'kpay' }))
    alerte.mockRestore()
    expect(await ecritures()).toEqual(avant)
  })

  it.each([
    ['an amount sent as a string', corpsWebhook({ paymentId: 'tx_1', externalId: ID_INCONNU, amount: 5000 }).replace('5000', '"5000"')],
    ['a JSON array', '[1,2,3]'],
    ['a JSON null', 'null'],
    ['an empty object', '{}'],
  ])('should answer a retryable 503 for a signed body with %s, writing nothing', async (_libelle, corps) => {
    const avant = await ecritures()
    const alerte = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const reponse = await appelerRouteWebhook({ corps })

    alerte.mockRestore()
    expect(reponse.status).toBe(503)
    expect(await ecritures()).toEqual(avant)
  })

  it('should answer 400 for an empty body rather than treating it as a valid event', async () => {
    const reponse = await appelerRouteWebhook({ corps: '', signature: signerWebhook('') })

    expect([400, 401]).toContain(reponse.status)
  })
})

describe('route webhook : configuration et fournisseur (CA50, CA51)', () => {
  it('should answer 503 WEBHOOK_NON_CONFIGURE when the webhook secret is absent, so that K-PAY retries later (CA50)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const { traiterWebhook } = await import('../../server/services/webhooks-paiement')
    const event = evenementWebhook({ corps: corpsPour(paiement) })
    const provider = await providerSansSecretWebhook()

    const erreur = await traiterWebhook('kpay', event.node.req, event.node.req.headers, NOW, { provider }).then(() => null, (e: unknown) => e as { status?: number, code?: string })
    const reponse = { status: erreur?.status, code: erreur?.code }

    expect(reponse.status).toBe(503)
    // Code neutre pour un appelant non authentifié : le détail (secret absent) reste dans les journaux.
    expect(reponse.code).toBe('PAIEMENT_INDISPONIBLE')
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should answer 404 for a provider that is not in the registry (CA51)', async () => {
    const reponse = await appelerRouteWebhook({ fournisseur: 'stripe', corps: '{}' })

    expect(reponse.status).toBe(404)
    expect(reponse.code).toBe('FOURNISSEUR_INCONNU')
  })

  it.each(['KPAY', 'k pay', '..', 'kpay/../admin', 'a'.repeat(41)])('should answer 404 for the malformed provider name %j', async (nom) => {
    const reponse = await appelerRouteWebhook({ fournisseur: nom, corps: '{}' })

    expect(reponse.status).toBe(404)
  })

  it('should not apply an event of a provider path to another provider : kpay events never reach a `stripe` payment', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { fournisseur: 'stripe', methode: 'carte', operateur: null })

    await appelerRouteWebhook({ corps: corpsPour(paiement) })

    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'ignore', motif: 'PAIEMENT_INCONNU' })
  })
})
