import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { abonnements } from '../../shared/db/schema'
import { MESSAGES_ECHEC } from '../../shared/paiements'
import { db } from '../../server/utils/db'
import { corpsWebhook, KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK } from '../support/faux-kpay'
import {
  compter,
  corpsPour,
  ECHEANCE_1_MOIS_DEPUIS_NOW,
  insererPaiement,
  lireAbonnement,
  lireEvenements,
  lirePaiement,
  NOW,
  poserAbonnement,
  recevoir,
  recevoirEnParallele,
  resumeEvenement,
  jours,
  plus,
} from './support/abonnements'
import { createUser } from './support/fabriques'
import { lireOutbox } from './support/notifications'
import { espionnerJournaux } from './support/planification'
import type { EspionJournaux } from './support/planification'

// S10 §6 CA38 à CA47, CA52 : application d'un webhook K-PAY signé, contre la VRAIE base (PostgreSQL), horloge injectée.
// La signature est vérifiée par l'adaptateur réel (`recevoirWebhook`). Seul K-PAY est absent : on forge ses événements
// signés avec le secret de test. Routes HTTP (413, 401, 503…) : webhook-kpay-route.test.ts.

let journaux: EspionJournaux | undefined

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function paiementEnAttente(surcharges: Parameters<typeof insererPaiement>[1] = {}) {
  const user = await createUser()
  const paiement = await insererPaiement(user.id, surcharges)
  return { user, paiement }
}

describe('activation par un webhook completed (CA38)', () => {
  it('should answer 200, mark the payment succeeded, create the subscription at the next local midnight, journal one event and queue one receipt', async () => {
    const { user, paiement } = await paiementEnAttente()

    const reponse = await recevoir(corpsPour(paiement))

    expect(reponse).toEqual({ status: 200, code: undefined })
    const apres = await lirePaiement(paiement.id)
    expect(apres.statut).toBe('reussi')
    expect(apres.appliqueLe).not.toBeNull()
    expect(apres.termineLe).not.toBeNull()
    expect(apres.codeEchec).toBeNull()
    expect(apres.prochaineVerification).toBeNull()
    expect(apres.abonnementExpireAvant).toBeNull()
    expect(apres.abonnementExpireApres?.toISOString()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.toISOString())
    const abonnement = await lireAbonnement(user.id)
    expect(abonnement?.expireLe.toISOString()).toBe('2026-12-03T23:00:00.000Z')
    expect(abonnement?.plan).toBe('payant')
    expect(abonnement?.dernierPaiementId).toBe(paiement.id)
    expect(abonnement?.premiereActivationLe.toISOString()).toBe(NOW.toISOString())
    const evenements = await lireEvenements()
    expect(evenements.map(resumeEvenement)).toEqual([
      { evenement: 'payment.completed', source: 'webhook', traitement: 'applique', motif: null, paiementId: paiement.id },
    ])
    const recus = await lireOutbox({ entiteId: paiement.id, type: 'paiement_confirme' })
    expect(recus).toHaveLength(1)
    expect(recus[0]).toMatchObject({ entiteType: 'paiement', categorie: 'transactionnel', statut: 'en_attente' })
  })

  it('should keep the real identifier and reference of the provider on the payment', async () => {
    const { paiement } = await paiementEnAttente({ idFournisseur: null, initiationIncertaine: true })

    await recevoir(corpsPour(paiement, { paymentId: 'tx_vu_par_webhook', reference: 'KPAY-20261103-XYZ' }))

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', idFournisseur: 'tx_vu_par_webhook', referenceFournisseur: 'KPAY-20261103-XYZ' })
  })

  it('should activate a payment still in `cree` (the webhook can beat the initiation update)', async () => {
    const { paiement } = await paiementEnAttente({ statut: 'cree', idFournisseur: null })

    await recevoir(corpsPour(paiement, { paymentId: 'tx_rapide' }))

    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })
})

describe('rejeu et concurrence (CA39, CA40)', () => {
  it('should answer the same 200 and change nothing when the same body is replayed (CA39)', async () => {
    const { user, paiement } = await paiementEnAttente()
    const corps = corpsPour(paiement)
    await recevoir(corps)
    const avant = await lireAbonnement(user.id)

    const rejeu = await recevoir(corps)

    expect(rejeu).toEqual({ status: 200, code: undefined })
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(avant?.expireLe.toISOString())
    expect(await compter('evenements_paiement')).toBe(1)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should extend only once when the same event arrives twice in parallel on two connections (CA40)', async () => {
    const { user, paiement } = await paiementEnAttente()

    const reponses = await recevoirEnParallele(corpsPour(paiement), 2)

    expect(reponses).toEqual([{ status: 200, code: undefined }, { status: 200, code: undefined }])
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.toISOString())
    expect(await compter('evenements_paiement')).toBe(1)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should extend only once when eight identical webhooks race', async () => {
    const { user, paiement } = await paiementEnAttente()

    const reponses = await recevoirEnParallele(corpsPour(paiement), 8)

    expect(reponses.every((r) => r.status === 200)).toBe(true)
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.toISOString())
    expect(await compter('evenements_paiement')).toBe(1)
  })
})

describe('anti-fraude (CA42, CA52)', () => {
  it('should flag a wrong amount as an anomaly, answer 200, create NO subscription and log codes only (CA42)', async () => {
    journaux = espionnerJournaux()
    const { user, paiement } = await paiementEnAttente()

    const reponse = await recevoir(corpsPour(paiement, { amount: 4000 }))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'MONTANT_INCOHERENT', appliqueLe: null })
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect((await lireEvenements()).map(resumeEvenement)).toEqual([
      { evenement: 'payment.completed', source: 'webhook', traitement: 'anomalie', motif: 'MONTANT_INCOHERENT', paiementId: paiement.id },
    ])
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(0)
    const sortie = journaux.contenu()
    for (const interdit of ['653456789', '237653456789', KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK]) {
      expect(sortie).not.toContain(interdit)
    }
  })

  it.each([
    ['a decimal amount', { amount: 5000.5 }],
    ['a zero amount', { amount: 0 }],
    ['an amount one unit too high', { amount: 5001 }],
  ])('should flag %s as MONTANT_INCOHERENT', async (_libelle, surcharges) => {
    const { user, paiement } = await paiementEnAttente()

    await recevoir(corpsPour(paiement, surcharges))

    expect((await lirePaiement(paiement.id)).codeEchec).toBe('MONTANT_INCOHERENT')
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should flag another provider id for the same externalId as ID_INCOHERENT and activate nothing (CA52)', async () => {
    const { user, paiement } = await paiementEnAttente({ idFournisseur: 'tx_A' })

    await recevoir(corpsPour(paiement, { paymentId: 'tx_B' }))

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'ID_INCOHERENT', idFournisseur: 'tx_A' })
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should flag a provider id already carried by ANOTHER payment (unique index) as ID_INCOHERENT, never crash', async () => {
    const premier = await paiementEnAttente({ idFournisseur: 'tx_partage' })
    const second = await paiementEnAttente({ idFournisseur: null, initiationIncertaine: true })

    const reponse = await recevoir(corpsPour(second.paiement, { paymentId: 'tx_partage' }))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(second.paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'ID_INCOHERENT' })
    expect((await lirePaiement(premier.paiement.id)).statut).toBe('en_attente')
  })

  it('should flag a currency that differs from ours when the body carries one, and accept the same currency', async () => {
    const mauvais = await paiementEnAttente()
    const bon = await paiementEnAttente()

    await recevoir(corpsPour(mauvais.paiement, { currency: 'EUR' }))
    await recevoir(corpsPour(bon.paiement, { currency: 'XAF' }))

    expect(await lirePaiement(mauvais.paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'DEVISE_INCOHERENTE' })
    expect((await lirePaiement(bon.paiement.id)).statut).toBe('reussi')
  })

  it('should treat a payment of the other environment (live payment, test key) as unknown', async () => {
    const { user, paiement } = await paiementEnAttente({ environnement: 'live' })

    await recevoir(corpsPour(paiement))

    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'ignore', motif: 'PAIEMENT_INCONNU' })
  })

  it('should never let a second, correct event rescue an anomaly (final status, manual decision)', async () => {
    const { user, paiement } = await paiementEnAttente()
    await recevoir(corpsPour(paiement, { amount: 4000 }))

    await recevoir(corpsPour(paiement, { paymentId: 'tx_autre_evenement' }))

    expect((await lirePaiement(paiement.id)).statut).toBe('anomalie')
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })
})

describe('événements sans paiement ou sans effet (CA43, CA44, CA47)', () => {
  it('should journal an unknown externalId as ignored PAIEMENT_INCONNU and write nothing else (CA43)', async () => {
    const reponse = await recevoir(corpsWebhook({ paymentId: 'tx_x', externalId: '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10', amount: 5000 }))

    expect(reponse.status).toBe(200)
    expect((await lireEvenements()).map(resumeEvenement)).toEqual([
      { evenement: 'payment.completed', source: 'webhook', traitement: 'ignore', motif: 'PAIEMENT_INCONNU', paiementId: null },
    ])
    expect(await compter('abonnements')).toBe(0)
    expect(await lireOutbox()).toHaveLength(0)
  })

  it.each(['payout.completed', 'refund.completed', 'payout.failed'])('should journal %s as ignored EVENEMENT_NON_GERE and leave the payment untouched (CA44)', async (evenement) => {
    const { user, paiement } = await paiementEnAttente()

    const reponse = await recevoir(corpsPour(paiement, { event: evenement, paymentId: `tx_${evenement}` }))

    expect(reponse.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect((await lireEvenements()).map((e) => e.motif)).toEqual(['EVENEMENT_NON_GERE'])
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should keep a succeeded payment untouched when a failed event arrives later, and journal it as ignored (CA47)', async () => {
    const { paiement } = await paiementEnAttente()
    await recevoir(corpsPour(paiement))

    const reponse = await recevoir(corpsPour(paiement, { event: 'payment.failed', status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' }))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', codeEchec: null })
    expect((await lireEvenements()).map((e) => `${e.evenement}:${e.traitement}`).sort()).toEqual(['payment.completed:applique', 'payment.failed:ignore'])
  })

  it('should not change anything for a non terminal status (PROCESSING) and write no journal line', async () => {
    const { paiement } = await paiementEnAttente()

    await recevoir(corpsPour(paiement, { event: 'payment.processing', status: 'PROCESSING' }))

    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await compter('evenements_paiement')).toBe(0)
  })
})

describe('échec, annulation, expiration tardive (CA45, CA46)', () => {
  it('should record a failure with its code, give the payer the matching message and extend nothing (CA45)', async () => {
    const { user, paiement } = await paiementEnAttente()
    const { toPaiementResource } = await import('../../server/resources/abonnement')

    await recevoir(corpsPour(paiement, { event: 'payment.failed', status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' }))

    const apres = await lirePaiement(paiement.id)
    expect(apres).toMatchObject({ statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND', appliqueLe: null })
    expect(apres.termineLe).not.toBeNull()
    expect(toPaiementResource(apres)).toMatchObject({ statut: 'echoue', messageEchec: MESSAGES_ECHEC.PAYER_NOT_FOUND })
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should fall back to the default message for a failure code we do not know', async () => {
    const { paiement } = await paiementEnAttente()
    const { toPaiementResource } = await import('../../server/resources/abonnement')

    await recevoir(corpsPour(paiement, { event: 'payment.failed', status: 'FAILED', failureReason: 'CODE_INVENTE_PAR_K_PAY' }))

    expect(toPaiementResource(await lirePaiement(paiement.id)).messageEchec).toBe(MESSAGES_ECHEC.DEFAUT)
  })

  it('should record a cancellation', async () => {
    const { paiement } = await paiementEnAttente()

    await recevoir(corpsPour(paiement, { event: 'payment.cancelled', status: 'CANCELLED' }))

    expect((await lirePaiement(paiement.id)).statut).toBe('annule')
  })

  it('should STILL apply a signed completed event to a payment that expired locally: the money was taken (CA46)', async () => {
    const { user, paiement } = await paiementEnAttente({ statut: 'expire', codeEchec: 'EXPIRE', expireAvant: plus(NOW, -jours(1)) })

    const reponse = await recevoir(corpsPour(paiement))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', codeEchec: null })
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.toISOString())
  })

  it.each(['echoue', 'annule'] as const)('should also apply a completed event to a payment recorded as %s', async (statut) => {
    const { user, paiement } = await paiementEnAttente({ statut, codeEchec: statut === 'echoue' ? 'PAYMENT_NOT_APPROVED' : null })

    await recevoir(corpsPour(paiement))

    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
    expect(await lireAbonnement(user.id)).toBeDefined()
  })

  it('should let a failed event turn an expired payment into failed, never the other way round after success', async () => {
    const { paiement } = await paiementEnAttente({ statut: 'expire', codeEchec: 'EXPIRE' })

    await recevoir(corpsPour(paiement, { event: 'payment.failed', status: 'FAILED', failureReason: 'PAYMENT_NOT_APPROVED' }))

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'echoue', codeEchec: 'PAYMENT_NOT_APPROVED' })
  })
})

describe('activation puis prolongation, utilisateurs particuliers (CA60, CA63)', () => {
  it('should extend from the current expiry when active, and chain the before/after snapshots (CA60)', async () => {
    const { user, paiement } = await paiementEnAttente({ periodeMois: 3, montantPlan: 13500, montant: 13500, fraisEstimes: 675, netEstime: 12825 })
    await poserAbonnement(user.id, new Date('2026-12-03T23:00:00.000Z'))

    await recevoir(corpsPour(paiement), { now: new Date('2026-11-20T10:00:00.000Z') })

    const apres = await lirePaiement(paiement.id)
    expect(apres.abonnementExpireAvant?.toISOString()).toBe('2026-12-03T23:00:00.000Z')
    expect(apres.abonnementExpireApres?.toISOString()).toBe('2027-03-03T23:00:00.000Z')
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe('2027-03-03T23:00:00.000Z')
  })

  it('should restart from now during the grace period: the grace is not billed (CA61)', async () => {
    const { user, paiement } = await paiementEnAttente()
    await poserAbonnement(user.id, new Date('2026-12-03T23:00:00.000Z'))

    await recevoir(corpsPour(paiement), { now: new Date('2026-12-06T10:00:00.000Z') })

    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe('2027-01-06T23:00:00.000Z')
  })

  it('should lose no extension when a 1 month and a 3 months payment of the same user are confirmed in parallel (CA63)', async () => {
    const user = await createUser()
    const un = await insererPaiement(user.id, { periodeMois: 1 })
    const trois = await insererPaiement(user.id, { periodeMois: 3, montantPlan: 13500, montant: 13500, fraisEstimes: 675, netEstime: 12825 })

    const reponses = await Promise.all([recevoir(corpsPour(un)), recevoir(corpsPour(trois))])

    expect(reponses.every((r) => r.status === 200)).toBe(true)
    // 14:00 locale + 1 mois puis + 3 mois = 2027-03-04 00:00 locale... : 4 mois depuis la base, arrondis au minuit local.
    const abonnement = await lireAbonnement(user.id)
    expect(abonnement?.expireLe.toISOString()).toBe('2027-03-03T23:00:00.000Z')
    const [a, b] = await Promise.all([lirePaiement(un.id), lirePaiement(trois.id)])
    const [premier, second] = [a, b].sort((x, y) => (x.abonnementExpireApres?.getTime() ?? 0) - (y.abonnementExpireApres?.getTime() ?? 0))
    expect(premier?.abonnementExpireApres?.getTime()).toBe(second?.abonnementExpireAvant?.getTime())
    expect(second?.abonnementExpireApres?.toISOString()).toBe('2027-03-03T23:00:00.000Z')
    expect(await compter('abonnements')).toBe(1)
  })

  it('should fall back to Africa/Douala when the stored time zone is invalid, instead of blocking an already paid extension', async () => {
    const user = await createUser({ fuseau: 'Mars/Olympus' })
    const paiement = await insererPaiement(user.id)

    const reponse = await recevoir(corpsPour(paiement))

    expect(reponse.status).toBe(200)
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.toISOString())
  })

  it('should honour the time zone of the account (Europe/Paris, summer time)', async () => {
    const user = await createUser({ fuseau: 'Europe/Paris' })
    const paiement = await insererPaiement(user.id)

    await recevoir(corpsPour(paiement), { now: new Date('2027-03-10T11:00:00.000Z') })

    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe('2027-04-10T22:00:00.000Z')
  })

  it('should keep a succeeded payment as an accounting record when the account was deleted, without crash nor receipt', async () => {
    const paiement = await insererPaiement(null)

    const reponse = await recevoir(corpsPour(paiement))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', userId: null })
    expect(await compter('abonnements')).toBe(0)
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(0)
  })

  it('should have exactly one subscription row per user and a CHECK-valid activation date after several payments', async () => {
    const user = await createUser()
    for (let i = 0; i < 3; i += 1) {
      const p = await insererPaiement(user.id)
      await recevoir(corpsPour(p), { now: plus(NOW, jours(i)) })
    }

    const lignes = await db.select().from(abonnements).where(eq(abonnements.userId, user.id))
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.premiereActivationLe.getTime()).toBeLessThan(lignes[0]!.expireLe.getTime())
  })
})

describe('déduplication : un événement ignoré ne bloque pas un événement applicable (revue MAJOR-1)', () => {
  it('should activate the subscription when a completed event follows an ignored one with the same key (unknown status, then COMPLETED)', async () => {
    const { user, paiement } = await paiementEnAttente()
    const idTransaction = paiement.idFournisseur ?? ''

    // 1. Même clé (kpay, transaction, payment.completed) mais statut illisible : journalisé `ignore`, rien d'appliqué.
    const premier = await recevoir(corpsPour(paiement, { paymentId: idTransaction, status: 'MYSTERE' }))
    expect(premier.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect((await lireEvenements()).map((e) => e.traitement)).toEqual(['ignore'])

    // 2. Le vrai résultat arrive : il n'est PAS un doublon, il active l'abonnement et met la ligne du journal à jour.
    const second = await recevoir(corpsPour(paiement, { paymentId: idTransaction }))

    expect(second.status).toBe(200)
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.toISOString())
    const evenements = await lireEvenements()
    expect(evenements).toHaveLength(1)
    expect(evenements[0]).toMatchObject({ traitement: 'applique', motif: null, paiementId: paiement.id })
    expect(await lireOutbox({ entiteId: paiement.id, type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should still treat a replay of an APPLIED event as a duplicate', async () => {
    const { user, paiement } = await paiementEnAttente()
    await recevoir(corpsPour(paiement))
    const apres = (await lireAbonnement(user.id))?.expireLe.toISOString()

    await recevoir(corpsPour(paiement))

    expect((await lireAbonnement(user.id))?.expireLe.toISOString()).toBe(apres)
    expect(await lireEvenements()).toHaveLength(1)
  })
})

describe('contrôles anti-fraude : seul un succès incohérent est une anomalie finale (revue MINEUR 2)', () => {
  it('should journal a FAILED event with a wrong amount as ignored, keeping the payment open for a genuine completed', async () => {
    const { paiement } = await paiementEnAttente()

    await recevoir(corpsPour(paiement, { event: 'payment.failed', status: 'FAILED', amount: 4000 }))

    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect((await lireEvenements()).map((e) => `${e.traitement}:${e.motif}`)).toEqual(['ignore:MONTANT_INCOHERENT'])

    await recevoir(corpsPour(paiement))
    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
  })
})

describe('journal d’audit : statut brut du fournisseur (revue MINEUR 1)', () => {
  it('should keep the provider status as written (COMPLETED) in statut_fournisseur', async () => {
    const { paiement } = await paiementEnAttente()

    await recevoir(corpsPour(paiement))

    expect((await lireEvenements())[0]?.statutFournisseur).toBe('COMPLETED')
  })
})
