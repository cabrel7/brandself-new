import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { messageEchec, MESSAGES_ECHEC } from '../../shared/paiements'
import { signerWebhook } from '../support/faux-kpay'
import {
  corpsEvenementMercy,
  corpsPaiementMercy,
  demarrerFauxMercyPay,
  MERCY_ENTETE_SIGNATURE,
  MERCY_TEST_AUTRE_SECRET,
  MERCY_TEST_CLE_API,
  MERCY_TEST_CLE_LIVE,
  MERCY_TEST_SECRET_WEBHOOK,
  signerWebhookMercy,
  surchargeEnvMercy,
} from '../support/faux-mercypay'
import type { FauxMercyPay } from '../support/faux-mercypay'
import { appelerRouteWebhook, compter, insererPaiement, lireAbonnement, lireEvenements, lirePaiement, resumeEvenement } from './support/abonnements'
import type { PaiementSeed } from './support/abonnements'
import { lireRefus } from './support/admin-a3'
import { createUser } from './support/fabriques'
import { lireOutbox } from './support/notifications'

// `shared/env.ts` lit `process.env` UNE fois, avant ce fichier (le setup importe la base). Les variables MERCY_PAY_* ne peuvent donc
// être posées qu'en remplaçant le module `env` : le proxy de faux-mercypay.ts les surcharge (et masque celles du poste du développeur).
vi.mock('../../shared/env', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../shared/env')>()
  const { envAvecSurcharge } = await import('../support/faux-mercypay')
  return { ...reel, env: envAvecSurcharge(reel.env) }
})

// P1 CA-M04, CA-M08 à CA-M13, CA-M15, CA-M21 : la ROUTE `POST /api/webhooks/mercypay` (handler Nitro réel sur événement h3 réel),
// la signature `MercyPay-Signature` réelle, VRAIE base PostgreSQL, VRAI Redis. Seul le serveur Mercy est factice (il ne sert pas ici :
// Mercy POSTe vers nous). Réponse 200 pour tout événement signé et lisible : Mercy désactive l'endpoint après des échecs persistants.
// Prérequis : migration 0033 (`source = 'fournisseur'`).

const PAIEMENT_ID_CHEMIN = 'pay_x'
const JOUR = 86_400_000

let faux: FauxMercyPay

beforeAll(async () => {
  faux = await demarrerFauxMercyPay()
})
afterAll(async () => {
  await faux.fermer()
})
beforeEach(() => {
  surchargeEnvMercy.MERCY_PAY_API_KEY = MERCY_TEST_CLE_API
  surchargeEnvMercy.MERCY_PAY_WEBHOOK_SECRET = MERCY_TEST_SECRET_WEBHOOK
  surchargeEnvMercy.MERCY_PAY_BASE_URL = faux.baseUrl
  surchargeEnvMercy.MERCY_PAY_MODE_TEST_AUTORISE = false
})
afterEach(() => {
  for (const cle of Object.keys(surchargeEnvMercy)) Reflect.deleteProperty(surchargeEnvMercy, cle)
})

/** POST de la route avec l'en-tête Mercy. `signature: null` = aucun en-tête ; sinon calculée sur les OCTETS envoyés. */
async function webhook(
  corps: string,
  options: { signature?: string | null, secret?: string, t?: number, fournisseur?: string, entetes?: Record<string, string> } = {},
) {
  const octets = Buffer.from(corps, 'utf8')
  const signature = options.signature === undefined
    ? signerWebhookMercy(octets, { ...(options.secret === undefined ? {} : { secret: options.secret }), ...(options.t === undefined ? {} : { t: options.t }) })
    : options.signature
  return appelerRouteWebhook({
    fournisseur: options.fournisseur ?? 'mercypay',
    corps: octets,
    signature: null,
    entetes: { ...(signature === null ? {} : { [MERCY_ENTETE_SIGNATURE]: signature }), ...(options.entetes ?? {}) },
  })
}

/** Paiement Mercy en attente : 1 mois, 5000 XAF, frais 350 pb à la charge du marchand (175, net 4825). */
function insererPaiementMercy(userId: string, seed: PaiementSeed = {}) {
  return insererPaiement(userId, {
    fournisseur: 'mercypay',
    source: 'fournisseur',
    idFournisseur: PAIEMENT_ID_CHEMIN,
    operateur: 'MTN_MOMO_CMR',
    montantPlan: 5000,
    montant: 5000,
    periodeMois: 1,
    fraisTauxPb: 350,
    fraisEstimes: 175,
    netEstime: 4825,
    ...seed,
  })
}

const succes = (paiementId: string, surcharges: Partial<Parameters<typeof corpsPaiementMercy>[0]> = {}) =>
  corpsPaiementMercy({ paymentId: PAIEMENT_ID_CHEMIN, paiementId, amount: 5000, feeAmount: 175, netAmount: 4825, ...surcharges })

async function ecritures() {
  return { paiements: await compter('paiements'), evenements: await compter('evenements_paiement'), abonnements: await compter('abonnements') }
}

describe('signature invalide : 401 et comptage (CA-M04)', () => {
  it('should answer 401 SIGNATURE_INVALIDE for a re-serialised body (one space added) with the ORIGINAL signature, count it once, write nothing', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    const corps = succes(paiement.id)
    const signatureOrigine = signerWebhookMercy(Buffer.from(corps, 'utf8'))
    const reserialise = corps.replace('{"id"', '{ "id"')

    const reponse = await webhook(reserialise, { signature: signatureOrigine })

    expect(reponse.status).toBe(401)
    expect(reponse.code).toBe('SIGNATURE_INVALIDE')
    expect((await lireRefus()).filter((r) => r.fournisseur === 'mercypay' && r.motif === 'SIGNATURE_INVALIDE').map((r) => r.nombre)).toEqual([1])
    expect(await compter('evenements_paiement')).toBe(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it.each([
    ['absent', () => null],
    ['garbage', () => 'pas-une-signature'],
    ['made with another secret', () => 'AUTRE'],
    ['too old (t = now - 400 s)', () => 'ANCIENNE'],
    ['sent as the K-PAY header only', () => 'KPAY'],
  ])('should answer 401 for a signature %s and write nothing', async (_libelle, cas) => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    const avant = await ecritures()
    const corps = succes(paiement.id)
    const octets = Buffer.from(corps, 'utf8')
    const valeur = cas()

    const reponse = valeur === 'KPAY'
      ? await webhook(corps, { signature: null, entetes: { 'x-kpay-signature': signerWebhook(octets, MERCY_TEST_SECRET_WEBHOOK) } })
      : await webhook(corps, {
        signature: valeur === 'AUTRE'
          ? signerWebhookMercy(octets, { secret: MERCY_TEST_AUTRE_SECRET })
          : valeur === 'ANCIENNE' ? signerWebhookMercy(octets, { t: Math.floor(Date.now() / 1000) - 400 }) : valeur,
      })

    expect(reponse.status).toBe(401)
    expect(reponse.code).toBe('SIGNATURE_INVALIDE')
    expect(await ecritures()).toEqual(avant)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should reveal nothing about the cause of a refusal and check the signature BEFORE parsing (unreadable body = 401, not 400/503)', async () => {
    const reponse = await webhook('{pas du json', { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` })

    expect(reponse.status).toBe(401)
    expect(JSON.stringify(reponse)).not.toMatch(/hmac|secret|attendue|expected|timestamp|tolerance/i)
  })

  it('should accept a validly signed body during a secret rotation (two v1, only one ours) and apply it', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    const corps = succes(paiement.id)
    const signature = signerWebhookMercy(Buffer.from(corps, 'utf8'), { secretsSupplementaires: [MERCY_TEST_AUTRE_SECRET] })

    const reponse = await webhook(corps, { signature })

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })
})

describe('payment.succeeded (CA-M08, CA-M09)', () => {
  it('should answer 200 { recu: true } with no cache, mark the payment succeeded with the real fees, extend the subscription, journal it and queue the receipt', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(succes(paiement.id))

    expect(reponse.status).toBe(200)
    expect(reponse.corps).toEqual({ recu: true })
    expect(reponse.entetes['cache-control']).toContain('no-store')
    const apres = await lirePaiement(paiement.id)
    expect(apres).toMatchObject({ statut: 'reussi', fraisReels: 175, netReel: 4825, idFournisseur: PAIEMENT_ID_CHEMIN })
    expect(apres.appliqueLe).not.toBeNull()
    const abonnement = await lireAbonnement(user.id)
    const delta = (abonnement?.expireLe.getTime() ?? 0) - Date.now()
    expect(delta).toBeGreaterThan(27 * JOUR)
    expect(delta).toBeLessThan(33 * JOUR)
    expect((await lireEvenements()).map((e) => ({ ...resumeEvenement(e), fournisseur: e.fournisseur, idTransaction: e.idTransaction }))).toEqual([
      { evenement: 'payment.succeeded', source: 'webhook', traitement: 'applique', motif: null, paiementId: paiement.id, fournisseur: 'mercypay', idTransaction: PAIEMENT_ID_CHEMIN },
    ])
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should not need a session, cookie or Origin, and ignore unknown fields of the envelope and of data', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    const corps = succes(paiement.id, { extra: { champ_futur: true }, dataExtra: { customer: { email: 'x@y.cm' } } })

    const reponse = await webhook(corps, { entetes: { cookie: 'better-auth.session_token=forge.forge', origin: 'https://evil.example' } })

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })

  it('should deliver the SAME event (same evt_) twice: two 200, one single extension, expire_le unchanged, one journal line, one receipt (CA-M09)', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    const corps = succes(paiement.id, { eventId: 'evt_livraison_1' })

    const premiere = await webhook(corps)
    const avant = await lireAbonnement(user.id)
    const seconde = await webhook(corps)
    const apres = await lireAbonnement(user.id)

    expect([premiere.status, seconde.status]).toEqual([200, 200])
    expect(JSON.stringify(seconde.corps)).toBe(JSON.stringify(premiere.corps))
    expect(avant).toBeDefined()
    expect(apres?.expireLe.getTime()).toBe(avant?.expireLe.getTime())
    expect(await lireEvenements()).toHaveLength(1)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should extend only once when Mercy redelivers the payment under a NEW evt_ id, and when five deliveries race', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponses = await Promise.all(Array.from({ length: 5 }, () => webhook(succes(paiement.id, { eventId: `evt_${randomUUID()}` }))))
    const apres = await lireAbonnement(user.id)
    await webhook(succes(paiement.id, { eventId: 'evt_tardif' }))

    expect(reponses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(apres?.expireLe.getTime())
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should attach the pay_ identifier to a payment whose initiation was uncertain, through metadata.paiement_id', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id, { idFournisseur: null, initiationIncertaine: true, prochaineVerification: null })

    const reponse = await webhook(succes(paiement.id))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', idFournisseur: PAIEMENT_ID_CHEMIN })
  })

  it('should refuse to activate when metadata.paiement_id points to a payment attached to ANOTHER pay_ id (anomaly ID_INCOHERENT)', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id, { idFournisseur: 'pay_celui_du_paiement' })

    const reponse = await webhook(succes(paiement.id, { paymentId: 'pay_un_autre' }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).not.toBe('reussi')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'anomalie', motif: 'ID_INCOHERENT' })
  })

  it('should neither apply nor fail on an event for an unknown payment (200, journalled `ignore`)', async () => {
    const reponse = await webhook(succes(randomUUID(), { paymentId: 'pay_inconnu' }))

    expect(reponse.status).toBe(200)
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'ignore', motif: 'PAIEMENT_INCONNU' })
  })
})

describe('payment.failed (CA-M10)', () => {
  it.each([
    ['insufficient_balance', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_BALANCE'],
    ['transaction_expired', 'EXPIRE', 'EXPIRE'],
    ['payment_not_approved', 'PAYMENT_NOT_APPROVED', 'PAYMENT_NOT_APPROVED'],
  ])('should mark the payment `echoue` with code %s -> %s and its message, without extending the subscription', async (codeMercy, codeAttendu, cleMessage) => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(corpsPaiementMercy({ type: 'payment.failed', paymentId: PAIEMENT_ID_CHEMIN, paiementId: paiement.id, amount: 5000, failureCode: codeMercy }))

    expect(reponse.status).toBe(200)
    const apres = await lirePaiement(paiement.id)
    expect(apres).toMatchObject({ statut: 'echoue', codeEchec: codeAttendu })
    expect(messageEchec(apres.codeEchec)).toBe(MESSAGES_ECHEC[cleMessage])
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(0)
  })

  it('should show the DEFAUT message for an unknown failure code and never relay the provider text', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    await webhook(corpsPaiementMercy({
      type: 'payment.failed',
      paymentId: PAIEMENT_ID_CHEMIN,
      paiementId: paiement.id,
      amount: 5000,
      failureCode: 'code_jamais_vu',
      failureReason: 'TEXTE-BRUT-DE-MERCY',
    }))

    const apres = await lirePaiement(paiement.id)
    expect(apres.statut).toBe('echoue')
    expect(messageEchec(apres.codeEchec)).toBe(MESSAGES_ECHEC.DEFAUT)
    expect(JSON.stringify(apres)).not.toContain('TEXTE-BRUT-DE-MERCY')
  })
})

describe('événements hors paiement (CA-M11)', () => {
  it.each([
    ['webhook.test', {}],
    ['account.updated', { id: 'acct_1', object: 'account' }],
    ['provider_status.changed', { provider: 'MTN_MOMO_CMR', status: 'degraded' }],
  ])('should answer 200 (never 503) to a signed %s, modify no payment and journal it `ignore`', async (type, data) => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(corpsEvenementMercy({ type, data }))

    expect(reponse.status).toBe(200)
    expect(reponse.corps).toEqual({ recu: true })
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect((await lireEvenements()).map((e) => ({ evenement: e.evenement, traitement: e.traitement, paiementId: e.paiementId }))).toEqual([
      { evenement: type, traitement: 'ignore', paiementId: null },
    ])
  })

  it('should answer 200 to the same non-payment event delivered twice, and to two distinct events of the same type', async () => {
    const corps = corpsEvenementMercy({ id: 'evt_test_1', type: 'webhook.test', data: {} })

    const reponses = [await webhook(corps), await webhook(corps), await webhook(corpsEvenementMercy({ id: 'evt_test_2', type: 'webhook.test', data: {} }))]

    expect(reponses.map((r) => r.status)).toEqual([200, 200, 200])
  })

  it('should journal a refund `REMBOURSE` without shortening the subscription (D8)', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    await webhook(succes(paiement.id))
    const avant = await lireAbonnement(user.id)

    const reponse = await webhook(corpsPaiementMercy({ type: 'payment.refunded', paymentId: PAIEMENT_ID_CHEMIN, paiementId: paiement.id, amount: 5000 }))

    expect(reponse.status).toBe(200)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(avant?.expireLe.getTime())
    expect((await lireEvenements()).find((e) => e.evenement === 'payment.refunded')).toMatchObject({ motif: 'REMBOURSE' })
  })

  it('should answer a RETRYABLE 503 only for a signed body that does not respect the envelope (schema invalid), writing nothing', async () => {
    const avant = await ecritures()
    const alerte = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const reponse = await webhook('{"type":"payment.succeeded"}')

    alerte.mockRestore()
    expect(reponse.status).toBe(503)
    expect(await ecritures()).toEqual(avant)
  })
})

describe('incohérences de montant, de devise et d’environnement (CA-M12, CA-M13)', () => {
  it('should flag MONTANT_INCOHERENT for 4000 against a payment of 5000 and extend nothing', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(succes(paiement.id, { amount: 4000, feeAmount: 140, netAmount: 3860 }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('anomalie')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'anomalie', motif: 'MONTANT_INCOHERENT' })
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(0)
  })

  it('should flag DEVISE_INCOHERENTE for RWF and extend nothing', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(succes(paiement.id, { currency: 'RWF' }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('anomalie')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'anomalie', motif: 'DEVISE_INCOHERENTE' })
  })

  it('should apply NOTHING for livemode:true with a mp_sandbox_ key, and journal ENVIRONNEMENT_INCOHERENT (still 200)', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(succes(paiement.id, { livemode: true }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(0)
    const [ligne] = await lireEvenements()
    expect(ligne?.motif).toBe('ENVIRONNEMENT_INCOHERENT')
    expect(ligne?.traitement).not.toBe('applique')
  })

  it('should apply NOTHING for livemode:false with a mp_live_ key either (the control is symmetrical)', async () => {
    surchargeEnvMercy.MERCY_PAY_API_KEY = MERCY_TEST_CLE_LIVE
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)

    const reponse = await webhook(succes(paiement.id, { livemode: false }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect((await lireEvenements())[0]?.motif).toBe('ENVIRONNEMENT_INCOHERENT')
  })

  it('should let a coherent event through once the incoherent one was ignored (the payment is not locked)', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    await webhook(succes(paiement.id, { livemode: true, eventId: 'evt_faux_env' }))

    const reponse = await webhook(succes(paiement.id, { eventId: 'evt_bon_env' }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })
})

describe('paiement expiré localement puis payé (CA-M15)', () => {
  it('should extend the subscription exactly ONCE when payment.succeeded arrives after the local expiry, even if delivered again', async () => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id, { statut: 'expire', codeEchec: 'EXPIRE' })

    const premiere = await webhook(succes(paiement.id, { eventId: 'evt_apres_expiration' }))
    const apres = await lireAbonnement(user.id)
    const seconde = await webhook(succes(paiement.id, { eventId: 'evt_apres_expiration_bis' }))

    expect([premiere.status, seconde.status]).toEqual([200, 200])
    expect(apres).toBeDefined()
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(apres?.expireLe.getTime())
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBeLessThan(Date.now() + 33 * JOUR)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })
})

describe('secret de webhook absent hors production (CA-M21)', () => {
  beforeEach(() => {
    surchargeEnvMercy.MERCY_PAY_WEBHOOK_SECRET = undefined
  })

  it.each([
    ['a signature made with the usual test secret', (o: Buffer) => signerWebhookMercy(o)],
    ['a signature made with an EMPTY secret', (o: Buffer) => signerWebhookMercy(o, { secret: '' })],
    ['no signature at all', () => null],
  ])('should answer 401 SIGNATURE_INVALIDE (never 200, never 5xx) with %s, and write nothing', async (_libelle, signer) => {
    const user = await createUser()
    const paiement = await insererPaiementMercy(user.id)
    const avant = await ecritures()
    const corps = succes(paiement.id)

    const reponse = await webhook(corps, { signature: signer(Buffer.from(corps, 'utf8')) })

    expect(reponse.status).toBe(401)
    expect(reponse.code).toBe('SIGNATURE_INVALIDE')
    expect(await ecritures()).toEqual(avant)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should still answer 404 for a provider that is not in the registry', async () => {
    const reponse = await webhook('{}', { fournisseur: 'stripe' })

    expect(reponse.status).toBe(404)
    expect(reponse.code).toBe('FOURNISSEUR_INCONNU')
  })
})
