import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { abonnements, evenementsPaiement, paiements } from '../../shared/db/schema'
import { ACCOUNT_DELETION_PHRASE } from '../../shared/compte'
import { db } from '../../server/utils/db'
import { corpsWebhook } from '../support/faux-kpay'
import {
  compter,
  corpsPour,
  insererPaiement,
  lireAbonnement,
  lireEvenements,
  lirePaiement,
  lirePaiementsDe,
  NOW,
  NUMERO_NATIONAL,
  poserAbonnement,
  recevoir,
  plus,
  jours,
} from './support/abonnements'
import { creerPro, lireOutbox, RecordingTransport } from './support/notifications'
import { traiter } from './support/planification'

// S10 §1 #129 (rétention), #123 (reçu), CA04, CA76 : les paiements sont des PIÈCES COMPTABLES. Ils survivent à la suppression du
// compte (détachés de l'utilisateur), l'abonnement disparaît. Le reçu est envoyé une seule fois, sans numéro complet.

const normaliser = (texte: string): string => texte.replaceAll(/[\s\u202F\u00A0]+/gu, ' ')

describe('suppression du compte (CA04)', () => {
  it('should delete the subscription, keep every payment with a NULL user and keep the journal linked to its payment', async () => {
    const { deleteAccount } = await import('../../server/services/utilisateurs')
    const pro = await creerPro()
    await poserAbonnement(pro.user.id, plus(NOW, jours(30)))
    const reussi = await insererPaiement(pro.user.id, { statut: 'reussi', abonnementExpireApres: plus(NOW, jours(30)) })
    const ouvert = await insererPaiement(pro.user.id)
    await recevoir(corpsPour(ouvert))
    const evenementsAvant = (await lireEvenements()).length

    await deleteAccount(pro.user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: new Date() })

    expect(await lireAbonnement(pro.user.id)).toBeUndefined()
    expect(await compter('abonnements')).toBe(0)
    const restants = await db.select().from(paiements)
    expect(restants.map((p) => p.id).sort()).toEqual([reussi.id, ouvert.id].sort())
    expect(restants.every((p) => p.userId === null)).toBe(true)
    expect(restants.every((p) => p.telephoneMasque !== null)).toBe(true)
    const evenements = await db.select().from(evenementsPaiement)
    expect(evenements).toHaveLength(evenementsAvant)
    expect(evenements.every((e) => e.paiementId === ouvert.id)).toBe(true)
    expect((await lirePaiement(ouvert.id)).montant).toBe(5000)
  })

  it('should not touch the payments of other users when one account is deleted', async () => {
    const { deleteAccount } = await import('../../server/services/utilisateurs')
    const a = await creerPro()
    const b = await creerPro()
    await insererPaiement(a.user.id)
    await insererPaiement(b.user.id)
    await poserAbonnement(b.user.id, plus(NOW, jours(30)))

    await deleteAccount(a.user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: new Date() })

    expect(await lirePaiementsDe(b.user.id)).toHaveLength(1)
    expect(await lireAbonnement(b.user.id)).toBeDefined()
  })

  it('should still absorb a late webhook for a payment whose account is gone : 200, journaled, nothing extended', async () => {
    const { deleteAccount } = await import('../../server/services/utilisateurs')
    const pro = await creerPro()
    const paiement = await insererPaiement(pro.user.id)
    await deleteAccount(pro.user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: new Date() })

    const reponse = await recevoir(corpsPour(paiement))

    expect(reponse.status).toBe(200)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', userId: null })
    expect(await compter('abonnements')).toBe(0)
    expect(await db.select().from(abonnements).where(eq(abonnements.userId, pro.user.id))).toHaveLength(0)
  })

  it('should answer 200 and ignore an event whose payment row does not exist anymore (hard deleted accounting row)', async () => {
    const reponse = await recevoir(corpsWebhook({ paymentId: 'tx_orphelin', externalId: '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10', amount: 5000 }))

    expect(reponse.status).toBe(200)
    expect((await lireEvenements())[0]).toMatchObject({ traitement: 'ignore', motif: 'PAIEMENT_INCONNU' })
  })
})

describe('reçu de paiement (CA76)', () => {
  async function recuDe12Mois() {
    const pro = await creerPro({ emailContact: 'pro@exemple.test' })
    const paiement = await insererPaiement(pro.user.id, { periodeMois: 12, montantPlan: 48000, montant: 48000, fraisEstimes: 2400, netEstime: 45600 })
    await recevoir(corpsPour(paiement, { reference: 'KPAY-20261103-RECU01' }))
    const [ligne] = await lireOutbox({ entiteId: paiement.id, type: 'paiement_confirme' })
    return { pro, paiement, ligne: ligne! }
  }

  it('should contain the amount, the period, the wallet, the masked number and the new expiry, and never the full number', async () => {
    const { ligne } = await recuDe12Mois()

    const { ligne: envoyee, transport } = await traiter(ligne.id, NOW)

    expect(envoyee.statut).toBe('envoye')
    expect(transport.sends).toHaveLength(1)
    const texte = normaliser(transport.dernier.text)
    expect(texte).toContain('48 000 FCFA')
    expect(texte).toContain('12 mois')
    expect(texte).toContain('MTN MoMo')
    expect(texte).toContain('+237 6•• ••• •89')
    expect(texte).toMatch(/novembre 2027/)
    expect(texte).toContain('KPAY-20261103-RECU01')
    expect(texte.toLowerCase()).toContain('pas une facture')
    for (const interdit of [NUMERO_NATIONAL, '237653456789']) expect(texte).not.toContain(interdit)
    expect(normaliser(transport.dernier.subject)).not.toContain(NUMERO_NATIONAL)
  })

  it('should send the receipt only once even if the webhook is replayed and the outbox is processed twice', async () => {
    const { paiement, ligne } = await recuDe12Mois()
    await recevoir(corpsPour(paiement, { reference: 'KPAY-20261103-RECU01' }))
    const transport = new RecordingTransport()

    await traiter(ligne.id, NOW, transport)
    await traiter(ligne.id, plus(NOW, 60_000), transport)

    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
    expect(transport.sends).toHaveLength(1)
  })

  it('should send a transactional receipt with no unsubscribe header', async () => {
    const { ligne } = await recuDe12Mois()

    const { transport } = await traiter(ligne.id, NOW)

    expect(transport.dernier.headers?.['List-Unsubscribe']).toBeUndefined()
  })

  it('should queue no receipt for a failed or anomalous payment', async () => {
    const pro = await creerPro()
    const echoue = await insererPaiement(pro.user.id)
    await recevoir(corpsPour(echoue, { event: 'payment.failed', status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' }))
    const autre = await creerPro()
    const anomalie = await insererPaiement(autre.user.id)
    await recevoir(corpsPour(anomalie, { amount: 1 }))

    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(0)
  })
})
