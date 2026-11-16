import { describe, expect, it } from 'vitest'
import { db } from '../../../server/utils/db'
import { calculerNouvelleEcheance, choisirBase } from '../../../server/services/abonnements-regles'
import {
  appliquer,
  compter,
  corpsPour,
  ECHEANCE_1_MOIS_DEPUIS_NOW,
  insererPaiement,
  jours,
  lireAbonnement,
  lireEvenements,
  lirePaiement,
  lirePaiements,
  NOW,
  poserAbonnement,
  recevoir,
} from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { rejet } from '../support/erreurs'
import { compterOutbox, confirmationService, insererPaiementManuel } from '../support/admin-a3'

// A3 CA01/CA02/CA05 (cœur) et §4 : `confirmerPaiement` est l'UNIQUE chemin d'application d'un succès (webhook, revérification,
// marquage manuel). Base PostgreSQL RÉELLE, aucun mock de `confirmerPaiement`, de `prolonger` ni du journal ; l'horloge est
// injectée (`now`). Verrous : paiement puis utilisateur (spec §4).

const FUSEAU = 'Africa/Douala'

async function confirmer(id: string, now: Date = NOW, complements: Record<string, unknown> = {}) {
  const { confirmerPaiement } = await confirmationService()
  return db.transaction((tx) => confirmerPaiement(tx, id, now, complements))
}

const recus = (paiementId: string) => compterOutbox('paiement_confirme', paiementId)

describe('confirmerPaiement : application d\'un succès', () => {
  it('should apply a pending payment once: statut reussi, subscription created, one receipt', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const resultat = await confirmer(paiement.id)

    expect(resultat).toBe('applique')
    const lu = await lirePaiement(paiement.id)
    expect(lu).toMatchObject({ statut: 'reussi', codeEchec: null, prochaineVerification: null })
    expect(lu.appliqueLe?.getTime()).toBe(NOW.getTime())
    expect(lu.termineLe?.getTime()).toBe(NOW.getTime())
    expect(lu.abonnementExpireAvant).toBeNull()
    expect(lu.abonnementExpireApres?.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    const abonnement = await lireAbonnement(user.id)
    expect(abonnement?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    expect(abonnement?.dernierPaiementId).toBe(paiement.id)
    expect(await recus(paiement.id)).toBe(1)
  })

  it.each(['cree', 'en_attente', 'expire', 'echoue', 'annule'] as const)('should apply a payment that is %s (the money was taken: a late success is always applied)', async (statut) => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { statut })

    expect(await confirmer(paiement.id)).toBe('applique')

    expect((await lirePaiement(paiement.id)).statut).toBe('reussi')
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
  })

  it('should extend from the current expiry when the subscription is still active (never from now)', async () => {
    const user = await createUser()
    const echeance = new Date(NOW.getTime() + jours(10))
    await poserAbonnement(user.id, echeance)
    const paiement = await insererPaiement(user.id)

    await confirmer(paiement.id)

    const attendu = calculerNouvelleEcheance(choisirBase(NOW, echeance), 1, FUSEAU)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(attendu.getTime())
    const lu = await lirePaiement(paiement.id)
    expect(lu.abonnementExpireAvant?.getTime()).toBe(echeance.getTime())
    expect(lu.abonnementExpireApres?.getTime()).toBe(attendu.getTime())
  })

  it('should store the provider identifiers and real fees when the payment has none yet', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { statut: 'echoue', idFournisseur: null, referenceFournisseur: null })

    await confirmer(paiement.id, NOW, { idFournisseur: 'tx_nouveau', referenceFournisseur: 'KPAY-NOUVEAU', fraisReels: 250, netReel: 4750 })

    expect(await lirePaiement(paiement.id)).toMatchObject({ idFournisseur: 'tx_nouveau', referenceFournisseur: 'KPAY-NOUVEAU', fraisReels: 250, netReel: 4750 })
  })

  it('should never overwrite an identifier already known, and ignore a negative or unsafe amount', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { idFournisseur: 'tx_connu', referenceFournisseur: 'KPAY-CONNU' })

    await confirmer(paiement.id, NOW, { idFournisseur: 'tx_autre', referenceFournisseur: 'KPAY-AUTRE', fraisReels: -5, netReel: Number.MAX_SAFE_INTEGER })

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', idFournisseur: 'tx_connu', referenceFournisseur: 'KPAY-CONNU', fraisReels: null, netReel: null })
  })

  it('should keep a succeeded payment of a deleted account as an accounting record: reussi, no subscription, no receipt', async () => {
    const paiement = await insererPaiement(null)

    expect(await confirmer(paiement.id)).toBe('applique')

    const lu = await lirePaiement(paiement.id)
    expect(lu).toMatchObject({ statut: 'reussi', abonnementExpireAvant: null, abonnementExpireApres: null })
    expect(await compter('abonnements')).toBe(0)
    expect(await recus(paiement.id)).toBe(0)
  })

  it('should NOT send a receipt for a manual payment (D-A3-03) but still extend the subscription', async () => {
    const user = await createUser()
    const manuel = await insererPaiementManuel(user.id, { statut: 'cree' })

    expect(await confirmer(manuel.id)).toBe('applique')

    expect(await recus(manuel.id)).toBe(0)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    expect((await lirePaiement(manuel.id)).statut).toBe('reussi')
  })

  it('should write nothing when the surrounding transaction rolls back (no extension without a payment, no payment without an extension)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    const { confirmerPaiement } = await confirmationService()

    await rejet(db.transaction(async (tx) => {
      await confirmerPaiement(tx, paiement.id, NOW, {})
      throw new Error('échec après la confirmation')
    }))

    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await recus(paiement.id)).toBe(0)
  })
})

describe('confirmerPaiement : idempotence (CA01)', () => {
  it('should answer deja_applique with NO write at all when the payment is already succeeded', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    await confirmer(paiement.id)
    const paiementAvant = await lirePaiement(paiement.id)
    const abonnementAvant = await lireAbonnement(user.id)

    const resultats = [await confirmer(paiement.id, new Date(NOW.getTime() + jours(1))), await confirmer(paiement.id, new Date(NOW.getTime() + jours(2)))]

    expect(resultats).toEqual(['deja_applique', 'deja_applique'])
    expect(await lirePaiement(paiement.id)).toEqual(paiementAvant)
    expect(await lireAbonnement(user.id)).toEqual(abonnementAvant)
    expect(await recus(paiement.id)).toBe(1)
  })

  it('should refuse an anomaly without any write (final state, never reopened)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { statut: 'anomalie', codeEchec: 'MONTANT_INCOHERENT' })
    const avant = await lirePaiement(paiement.id)

    expect(await confirmer(paiement.id)).toBe('refuse_anomalie')

    expect(await lirePaiement(paiement.id)).toEqual(avant)
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await recus(paiement.id)).toBe(0)
  })

  it('should keep a single extension and a single receipt when 8 transactions confirm the SAME payment at once (CA02)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const resultats = await Promise.all(Array.from({ length: 8 }, () => confirmer(paiement.id)))

    expect(resultats.filter((r) => r === 'applique')).toHaveLength(1)
    expect(resultats.filter((r) => r === 'deja_applique')).toHaveLength(7)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    expect(await recus(paiement.id)).toBe(1)
    expect(await compter('abonnements')).toBe(1)
  })

  it('should chain, never lose, the extensions of TWO different payments of the same user confirmed at once', async () => {
    const user = await createUser()
    const a = await insererPaiement(user.id)
    const b = await insererPaiement(user.id)

    const resultats = await Promise.all([confirmer(a.id), confirmer(b.id)])

    expect(resultats).toEqual(['applique', 'applique'])
    const abonnement = await lireAbonnement(user.id)
    const un = calculerNouvelleEcheance(NOW, 1, FUSEAU)
    expect(abonnement?.expireLe.getTime()).toBe(calculerNouvelleEcheance(un, 1, FUSEAU).getTime())
    const lus = [await lirePaiement(a.id), await lirePaiement(b.id)]
    expect(new Set(lus.map((p) => p.abonnementExpireApres?.getTime())).size).toBe(2)
  })
})

describe('chemin du webhook et de l\'interrogation : délégation à confirmerPaiement', () => {
  it('should apply a webhook once and report the replay as a duplicate: one extension, one receipt, one journal line', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    const corps = corpsPour(paiement)

    const premier = await appliquer(corps)
    const rejeu = await appliquer(corps)

    expect(premier).toMatchObject({ traitement: 'applique', paiementId: paiement.id })
    expect(rejeu.traitement).toBe('doublon')
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    expect(await recus(paiement.id)).toBe(1)
    expect(await lireEvenements()).toHaveLength(1)
  })

  it('should not extend twice when the webhook arrives after the polling already applied the payment', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    const corps = corpsPour(paiement)

    const interrogation = await appliquer(corps, { source: 'interrogation' })
    const webhook = await appliquer(corps, { source: 'webhook' })

    expect(interrogation.traitement).toBe('applique')
    expect(webhook.traitement).toBe('doublon')
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    expect(await recus(paiement.id)).toBe(1)
  })

  it('should apply once when 8 identical webhooks arrive at the same time (real concurrency on the same provider reference)', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { referenceFournisseur: 'KPAY-UNIQUE' })
    const corps = corpsPour(paiement, { reference: 'KPAY-UNIQUE' })

    const reponses = await Promise.all(Array.from({ length: 8 }, () => recevoir(corps)))

    expect(reponses.every((r) => r.status === 200)).toBe(true)
    expect((await lirePaiements()).filter((p) => p.statut === 'reussi')).toHaveLength(1)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
    expect(await recus(paiement.id)).toBe(1)
  })

  it('should credit only ONE payment when two payments of two users claim the SAME provider transaction at once (no unique-index 500)', async () => {
    const [u1, u2] = [await createUser(), await createUser()]
    const [p1, p2] = [
      await insererPaiement(u1.id, { idFournisseur: null, initiationIncertaine: true }),
      await insererPaiement(u2.id, { idFournisseur: null, initiationIncertaine: true }),
    ]
    const commun = { paymentId: 'tx_commun', reference: 'KPAY-COMMUN' }

    const reponses = await Promise.all([recevoir(corpsPour(p1, commun)), recevoir(corpsPour(p2, commun))])

    expect(reponses.map((r) => r.status)).toEqual([200, 200])
    const lus = [await lirePaiement(p1.id), await lirePaiement(p2.id)]
    expect(lus.filter((p) => p.statut === 'reussi')).toHaveLength(1)
    expect(await compter('abonnements')).toBe(1)
  })
})

describe('référence K-PAY unique : garantie par la base, pas seulement par le code (CLAUDE.md 4.10)', () => {
  it('should let exactly ONE of two simultaneous confirmations claim the same provider reference, never credit both users', async () => {
    const [u1, u2] = [await createUser(), await createUser()]
    const [p1, p2] = [
      await insererPaiement(u1.id, { idFournisseur: null, referenceFournisseur: null, initiationIncertaine: true }),
      await insererPaiement(u2.id, { idFournisseur: null, referenceFournisseur: null, initiationIncertaine: true }),
    ]
    const complements = { idFournisseur: 'tx_unique', referenceFournisseur: 'KPAY-UNIQUE-REF' }

    const resultats = await Promise.allSettled([confirmer(p1.id, NOW, complements), confirmer(p2.id, NOW, complements)])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejet = resultats.find((r) => r.status === 'rejected')
    expect(rejet).toBeDefined()
    const lus = [await lirePaiement(p1.id), await lirePaiement(p2.id)]
    expect(lus.filter((p) => p.statut === 'reussi')).toHaveLength(1)
    expect(lus.filter((p) => p.referenceFournisseur === 'KPAY-UNIQUE-REF')).toHaveLength(1)
    expect(await compter('abonnements')).toBe(1)
  })
})

describe('montant incohérent : anomalie finale, jamais d\'activation (CA, D-A3-02)', () => {
  it('should turn a success carrying the NET amount into an anomaly: no extension, no receipt, final state', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    const resultat = await appliquer(corpsPour(paiement, { amount: 4750 }))

    expect(resultat).toMatchObject({ traitement: 'anomalie', motif: 'MONTANT_INCOHERENT', paiementId: paiement.id })
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'MONTANT_INCOHERENT' })
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await recus(paiement.id)).toBe(0)
  })

  it('should refuse to confirm that anomaly afterwards, and ignore a later correct success as STATUT_FINAL', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)
    await appliquer(corpsPour(paiement, { amount: 4750 }))

    expect(await confirmer(paiement.id)).toBe('refuse_anomalie')
    const tardif = await appliquer(corpsPour(paiement, { event: 'payment.completed', status: 'COMPLETED', timestamp: '2026-11-04T10:00:00.000Z' }), { source: 'interrogation' })

    expect(['doublon', 'ignore']).toContain(tardif.traitement)
    expect((await lirePaiement(paiement.id)).statut).toBe('anomalie')
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })
})
