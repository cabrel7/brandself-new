import { afterEach, describe, expect, it } from 'vitest'
import { PAIEMENTS_VERIFICATION_LOT } from '../../shared/jobs'
import { MESSAGES_ECHEC } from '../../shared/paiements'
import { corpsPour, initier, insererPaiement, lireAbonnement, lireEvenements, lirePaiement, moduleAbonnements, plus, recevoir, resumeEvenement, saturerBudgetKpay, SECONDE_MS, minutes, jours, NOW } from './support/abonnements'
import { createUser } from './support/fabriques'
import { fauxKpay } from './support/env-kpay'
import { lireOutbox } from './support/notifications'
import { espionnerJournaux } from './support/planification'
import type { EspionJournaux } from './support/planification'
import type { TransactionFausse } from '../support/faux-kpay'

// S10 §6 CA53 à CA58 : le rapprochement par le worker (`verifierPaiementsDus`) contre la VRAIE base, le VRAI Redis (budget) et
// le faux serveur K-PAY. Le webhook reste l'autorité ; l'interrogation n'est qu'un rattrapage borné.

let journaux: EspionJournaux | undefined

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function tick(now: Date) {
  const { verifierPaiementsDus } = await moduleAbonnements()
  return verifierPaiementsDus(now)
}

/** Initie un vrai paiement (1 mois, 5000) puis fait évoluer la transaction chez le faux K-PAY. */
async function paiementInitie(statutFournisseur: TransactionFausse['status'], options: { numero?: string } = {}) {
  const user = await createUser()
  const t0 = new Date()
  const paiement = await initier(user.id, { periodeMois: 1, ...(options.numero ? { telephone: options.numero } : {}) }, t0)
  const transaction = fauxKpay.derniereTransaction()
  fauxKpay.modifierTransaction(transaction.id, {
    status: statutFournisseur,
    ...(statutFournisseur === 'COMPLETED' ? { feeAmount: 250, netAmount: 4750 } : {}),
    ...(statutFournisseur === 'FAILED' ? { failureReason: 'PAYER_NOT_FOUND' } : {}),
  })
  return { user, paiement, t0, transaction }
}

describe('rattrapage d’un paiement terminé chez le fournisseur (CA53 à CA55)', () => {
  it('should apply a completed payment found by the poll : succeeded, extended, real fees and net stored, source `interrogation` (CA53)', async () => {
    const { user, paiement, t0 } = await paiementInitie('COMPLETED')

    const resultat = await tick(plus(t0, 20 * SECONDE_MS))

    expect(resultat).toMatchObject({ appliques: 1, interroges: 1 })
    const apres = await lirePaiement(paiement.id)
    expect(apres).toMatchObject({ statut: 'reussi', fraisReels: 250, netReel: 4750 })
    expect(apres.appliqueLe).not.toBeNull()
    expect(await lireAbonnement(user.id)).toBeDefined()
    expect((await lireEvenements()).map(resumeEvenement)).toEqual([
      { evenement: 'payment.completed', source: 'interrogation', traitement: 'applique', motif: null, paiementId: paiement.id },
    ])
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should treat the webhook arriving after the poll as a duplicate : same 200, same expiry, one journal line, one receipt (CA54)', async () => {
    const { user, paiement, t0, transaction } = await paiementInitie('COMPLETED')
    await tick(plus(t0, 20 * SECONDE_MS))
    const avant = await lireAbonnement(user.id)

    const reponse = await recevoir(corpsPour(await lirePaiement(paiement.id), { paymentId: transaction.id }), { now: plus(t0, 40 * SECONDE_MS) })

    expect(reponse.status).toBe(200)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(avant?.expireLe.getTime())
    expect(await lireEvenements()).toHaveLength(1)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should extend only once when the webhook and the poll hit the same payment at the same time (CA55)', async () => {
    const { user, paiement, t0, transaction } = await paiementInitie('COMPLETED')
    const corps = corpsPour(await lirePaiement(paiement.id), { paymentId: transaction.id })

    await Promise.all([tick(plus(t0, 20 * SECONDE_MS)), recevoir(corps, { now: plus(t0, 20 * SECONDE_MS) })])

    expect(await lireEvenements()).toHaveLength(1)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
    const abonnement = await lireAbonnement(user.id)
    expect(abonnement?.expireLe.getTime()).toBe((await lirePaiement(paiement.id)).abonnementExpireApres?.getTime())
  })

  it('should record a failure found by the poll with its code and extend nothing', async () => {
    const { user, paiement, t0 } = await paiementInitie('FAILED')

    await tick(plus(t0, 20 * SECONDE_MS))

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND' })
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should not touch anything when the provider no longer knows the transaction (404)', async () => {
    const { paiement, t0, transaction } = await paiementInitie('PENDING')
    fauxKpay.transactions.delete(transaction.id)

    const resultat = await tick(plus(t0, 20 * SECONDE_MS))

    expect(resultat.appliques).toBe(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should leave the payment alone and report an error when the provider fails, then succeed at the next due time', async () => {
    journaux = espionnerJournaux()
    const { paiement, t0 } = await paiementInitie('COMPLETED')
    fauxKpay.definirConsultation({ type: 'http', status: 500 })

    const echec = await tick(plus(t0, 20 * SECONDE_MS))
    fauxKpay.definirConsultation({ type: 'selon-transaction' })
    const lePaiement = await lirePaiement(paiement.id)
    const reprise = await tick(new Date(Math.max((lePaiement.prochaineVerification ?? t0).getTime(), t0.getTime() + 40 * SECONDE_MS)))

    expect(echec.erreurs).toBe(1)
    expect(reprise.appliques).toBe(1)
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })

  it('should reject a poll answer whose external id is not ours (never apply another merchant payment)', async () => {
    journaux = espionnerJournaux()
    const { paiement, t0, transaction } = await paiementInitie('COMPLETED')
    fauxKpay.modifierTransaction(transaction.id, { externalId: 'un-autre-paiement' })

    const resultat = await tick(plus(t0, 20 * SECONDE_MS))

    expect(resultat.appliques).toBe(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should detect an amount mismatch found by the poll as an anomaly and activate nothing', async () => {
    const { user, paiement, t0, transaction } = await paiementInitie('COMPLETED')
    fauxKpay.modifierTransaction(transaction.id, { amount: 4000 })

    await tick(plus(t0, 20 * SECONDE_MS))

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'MONTANT_INCOHERENT' })
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })
})

describe('calendrier de vérification (CA56)', () => {
  it('should stay `en_attente`, count the verification and space the next ones 15, 30, 60, 120 then 300 seconds (the calendar)', async () => {
    const { paiement, t0 } = await paiementInitie('PROCESSING')
    let horloge = plus(t0, 15 * SECONDE_MS)
    const ecarts: number[] = []

    for (let i = 0; i < 5; i += 1) {
      await tick(horloge)
      const ligne = await lirePaiement(paiement.id)
      expect(ligne.statut).toBe('en_attente')
      expect(ligne.verifications).toBe(i + 1)
      ecarts.push(((ligne.prochaineVerification?.getTime() ?? 0) - horloge.getTime()) / SECONDE_MS)
      horloge = ligne.prochaineVerification ?? horloge
    }

    // Le calendrier [15, 30, 60, 120, 300] s'applique aux vérifications (le dernier pas se répète) ; la première, à +15 s, est posée à l'initiation.
    expect(ecarts).toEqual([15, 30, 60, 120, 300])
  })

  it('should not ask the provider again before the next due time', async () => {
    const { t0 } = await paiementInitie('PROCESSING')
    await tick(plus(t0, 15 * SECONDE_MS))
    const appels = fauxKpay.consultations.length

    await tick(plus(t0, 16 * SECONDE_MS))
    await tick(plus(t0, 29 * SECONDE_MS))

    expect(fauxKpay.consultations.length).toBe(appels)
  })

  it('should not poll a payment before its first due time', async () => {
    const { t0 } = await paiementInitie('COMPLETED')

    const resultat = await tick(plus(t0, 5 * SECONDE_MS))

    expect(resultat.reclames).toBe(0)
    expect(fauxKpay.consultations).toHaveLength(0)
  })
})

describe('expiration locale et paiements sans identifiant (CA57)', () => {
  it('should never poll an uncertain payment that has no provider id, and expire it after `expire_avant` with the EXPIRE message', async () => {
    const user = await createUser()
    const incertain = await insererPaiement(user.id, { idFournisseur: null, initiationIncertaine: true, prochaineVerification: null, createdAt: NOW })

    await tick(plus(NOW, minutes(10)))
    const avant = await lirePaiement(incertain.id)
    await tick(plus(NOW, minutes(15) + SECONDE_MS))
    const apres = await lirePaiement(incertain.id)

    expect(fauxKpay.consultations).toHaveLength(0)
    expect(avant.statut).toBe('en_attente')
    expect(apres).toMatchObject({ statut: 'expire', codeEchec: 'EXPIRE' })
    expect(apres.termineLe).not.toBeNull()
    const { toPaiementResource } = await import('../../server/resources/abonnement')
    expect(toPaiementResource(apres).messageEchec).toBe(MESSAGES_ECHEC.EXPIRE)
  })

  it('should expire an open payment 15 minutes after its creation, not 30 (the `expire_avant` column already carries the delay)', async () => {
    const user = await createUser()
    const ouvert = await insererPaiement(user.id, { createdAt: NOW })

    await tick(plus(NOW, minutes(15) + SECONDE_MS))

    expect((await lirePaiement(ouvert.id)).statut).toBe('expire')
  })

  it('should not expire a payment before its deadline', async () => {
    const user = await createUser()
    const ouvert = await insererPaiement(user.id, { createdAt: NOW, prochaineVerification: null })

    await tick(plus(NOW, minutes(14)))

    expect((await lirePaiement(ouvert.id)).statut).toBe('en_attente')
  })

  it('should still apply a late completed webhook to an uncertain payment that expired (money taken, CA46)', async () => {
    const user = await createUser()
    const incertain = await insererPaiement(user.id, { idFournisseur: null, initiationIncertaine: true, prochaineVerification: null, createdAt: NOW })
    await tick(plus(NOW, minutes(20)))

    await recevoir(corpsPour(incertain, { paymentId: 'tx_tardif' }), { now: plus(NOW, minutes(25)) })

    expect((await lirePaiement(incertain.id)).statut).toBe('reussi')
    expect(await lireAbonnement(user.id)).toBeDefined()
  })

  it('should not let payments without a provider id starve the ones that have one (they must not occupy the batch)', async () => {
    const user = await createUser()
    for (let i = 0; i < PAIEMENTS_VERIFICATION_LOT + 1; i += 1) {
      await insererPaiement(user.id, { statut: 'cree', idFournisseur: null, createdAt: plus(NOW, -minutes(5) + i), prochaineVerification: plus(NOW, -SECONDE_MS) })
    }
    const autre = await createUser()
    const reel = await insererPaiement(autre.id, { idFournisseur: 'tx_reel', createdAt: plus(NOW, SECONDE_MS), prochaineVerification: plus(NOW, -SECONDE_MS) })
    fauxKpay.transactions.set('tx_reel', { id: 'tx_reel', reference: 'KPAY-REEL', status: 'COMPLETED', amount: 5000, currency: 'XAF', externalId: reel.id, provider: 'MTN_MOMO_CMR', phoneNumber: '237653456789', feeAmount: 250, netAmount: 4750 })

    await tick(NOW)

    expect((await lirePaiement(reel.id)).statut).toBe('reussi')
  })
})

describe('lot borné, SKIP LOCKED, budget (CA58)', () => {
  async function douze() {
    const ids: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const user = await createUser()
      const p = await insererPaiement(user.id, { idFournisseur: `tx_${i}`, createdAt: plus(NOW, i * SECONDE_MS), prochaineVerification: plus(NOW, -minutes(1)) })
      fauxKpay.transactions.set(`tx_${i}`, { id: `tx_${i}`, reference: `KPAY-${i}`, status: 'PROCESSING', amount: 5000, currency: 'XAF', externalId: p.id, provider: 'MTN_MOMO_CMR', phoneNumber: '237653456789' })
      ids.push(p.id)
    }
    return ids
  }

  it(`should process at most ${PAIEMENTS_VERIFICATION_LOT} payments per tick, oldest first (12 due)`, async () => {
    await douze()

    const resultat = await tick(NOW)

    expect(resultat.reclames).toBe(PAIEMENTS_VERIFICATION_LOT)
    expect(fauxKpay.consultations).toHaveLength(PAIEMENTS_VERIFICATION_LOT)
    expect(fauxKpay.consultations.map((c) => c.chemin).sort()).toEqual(['tx_0', 'tx_1', 'tx_2', 'tx_3', 'tx_4'].map((id) => `/api/v1/payments/${id}`))
  })

  it('should never poll the same payment twice when two ticks run at the same time (SKIP LOCKED)', async () => {
    await douze()

    const [a, b] = await Promise.all([tick(NOW), tick(NOW)])

    const chemins = fauxKpay.consultations.map((c) => c.chemin)
    expect(new Set(chemins).size).toBe(chemins.length)
    expect(a.reclames + b.reclames).toBeLessThanOrEqual(2 * PAIEMENTS_VERIFICATION_LOT)
    expect(chemins.length).toBe(a.reclames + b.reclames)
  })

  it('should drain the whole backlog over successive ticks without losing or repeating anyone', async () => {
    await douze()

    for (let i = 0; i < 3; i += 1) await tick(NOW)

    expect(new Set(fauxKpay.consultations.map((c) => c.chemin)).size).toBe(12)
    expect(fauxKpay.consultations).toHaveLength(12)
  })

  it('should stop polling when the global provider budget is spent, leaving every payment pending (fail safe)', async () => {
    const [premier] = await douze()
    await saturerBudgetKpay(60)

    const resultat = await tick(NOW)

    expect(resultat.interroges).toBe(0)
    expect(fauxKpay.consultations).toHaveLength(0)
    expect((await lirePaiement(premier!)).statut).toBe('en_attente')
  })

  it('should spend one budget unit per consultation', async () => {
    await douze()
    const { redis } = await import('../../server/utils/redis')

    await tick(NOW)

    const valeur = (await redis.get('limite:kpay:appels')) ?? (await redis.get('kpay:appels'))
    expect(Number(valeur)).toBe(PAIEMENTS_VERIFICATION_LOT)
  })

  it('should not call the provider for payments that are already final', async () => {
    const user = await createUser()
    await insererPaiement(user.id, { statut: 'reussi', prochaineVerification: plus(NOW, -jours(1)) })
    await insererPaiement(user.id, { statut: 'echoue', codeEchec: 'X', prochaineVerification: plus(NOW, -jours(1)) })

    const resultat = await tick(NOW)

    expect(resultat.reclames).toBe(0)
    expect(fauxKpay.consultations).toHaveLength(0)
  })
})
