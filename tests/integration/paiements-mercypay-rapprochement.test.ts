import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { redis } from '../../server/utils/redis'
import { demarrerFauxMercyPay, MERCY_TEST_CLE_API } from '../support/faux-mercypay'
import type { FauxMercyPay } from '../support/faux-mercypay'
import {
  initier,
  insererPaiement,
  lireAbonnement,
  lireEvenements,
  lirePaiement,
  lirePaiementsDe,
  moduleAbonnements,
  moduleFournisseurs,
  plus,
  resumeEvenement,
  SECONDE_MS,
} from './support/abonnements'
import { appelerAdmin, cleIdempotence, codeMarquage, desinstallerAdmin, installerAdmin, MOTIF, ROUTES } from './support/admin-a3'
import type { AdminConnecte } from './support/admin-a3'
import { createUser } from './support/fabriques'
import { lireOutbox } from './support/notifications'
import { espionnerJournaux } from './support/planification'
import type { EspionJournaux } from './support/planification'

// P1 CA-M14 et CA-M19 : rapprochement par le worker (`verifierPaiementsDus`) et marquage manuel par l'admin, pour un paiement Mercy Pay.
// VRAIE base PostgreSQL, VRAI Redis (budget), VRAI adaptateur ; seul le serveur Mercy est factice. Le fournisseur est construit par le
// registre SANS secret de webhook : c'est la situation du développement (application non hébergée), où l'interrogation est le seul
// chemin du résultat. Prérequis : migration 0033 (`source = 'fournisseur'`).

const ENTREE = { moyen: 'mercypay:MTN_MOMO_CMR', periodeMois: 1, prixAffiche: 5000 } as const

let faux: FauxMercyPay
let journaux: EspionJournaux | undefined

beforeAll(async () => {
  faux = await demarrerFauxMercyPay()
})
afterAll(async () => {
  await faux.fermer()
})
beforeEach(async () => {
  faux.reinitialiser()
  await redis.flushdb()
})
afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function providerMercy() {
  const { getPaiementProvider } = await moduleFournisseurs()
  const provider = getPaiementProvider('mercypay', {
    KPAY_API_KEY: undefined,
    KPAY_SECRET_KEY: undefined,
    KPAY_WEBHOOK_SECRET: undefined,
    KPAY_BASE_URL: 'https://admin.kpay.site',
    MERCY_PAY_API_KEY: MERCY_TEST_CLE_API,
    MERCY_PAY_WEBHOOK_SECRET: undefined,
    MERCY_PAY_BASE_URL: faux.baseUrl,
  })
  if (provider === null) throw new Error('Mercy Pay devrait être configuré par le registre.')
  return provider
}

async function tick(now: Date, provider: Awaited<ReturnType<typeof providerMercy>>) {
  const { verifierPaiementsDus } = await moduleAbonnements()
  return verifierPaiementsDus(now, { getProvider: (nom) => (nom === 'mercypay' ? provider : null) })
}

/** Initie un vrai paiement (1 mois, 5000) chez le faux Mercy, puis le fait évoluer chez lui. */
async function paiementInitie(modifications: Parameters<FauxMercyPay['modifierPaiement']>[1] = {}) {
  const user = await createUser()
  const provider = await providerMercy()
  const t0 = new Date()
  const paiement = await initier(user.id, ENTREE, t0, { provider })
  const chezMercy = faux.dernierPaiement()
  faux.modifierPaiement(chezMercy.id, modifications)
  return { user, provider, paiement, t0, chezMercy }
}

describe('rattrapage par interrogation (CA-M14)', () => {
  it('should GET /payments/{id} when the verification is due and apply a succeeded payment: succeeded, extended, real fees, source `interrogation`', async () => {
    const { user, provider, paiement, t0, chezMercy } = await paiementInitie({ status: 'succeeded' })

    const resultat = await tick(plus(t0, 20 * SECONDE_MS), provider)

    expect(resultat).toMatchObject({ appliques: 1, interroges: 1, erreurs: 0 })
    expect(faux.consultations).toHaveLength(1)
    expect(faux.consultations[0]?.chemin).toBe(`/api/v1/payments/${chezMercy.id}`)
    expect(faux.consultations[0]?.entetes.authorization).toBe(`Bearer ${MERCY_TEST_CLE_API}`)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'reussi', fraisReels: 175, netReel: 4825, fournisseur: 'mercypay', source: 'fournisseur' })
    expect(await lireAbonnement(user.id)).toBeDefined()
    const journal = (await lireEvenements()).map(resumeEvenement)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ source: 'interrogation', traitement: 'applique', paiementId: paiement.id })
    expect(await lireOutbox({ type: 'paiement_confirme' })).toHaveLength(1)
  })

  it('should apply a failed payment with its mapped failure code', async () => {
    const { provider, paiement, t0 } = await paiementInitie({ status: 'failed', failure_code: 'insufficient_balance' })

    await tick(plus(t0, 20 * SECONDE_MS), provider)

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'echoue', codeEchec: 'INSUFFICIENT_BALANCE' })
  })

  it('should leave a still-pending payment untouched (nothing applied, nothing journalled as applied)', async () => {
    const { user, provider, paiement, t0 } = await paiementInitie()

    const resultat = await tick(plus(t0, 20 * SECONDE_MS), provider)

    expect(resultat).toMatchObject({ appliques: 0, interroges: 1 })
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should not call Mercy before the verification is due', async () => {
    const { provider, t0 } = await paiementInitie({ status: 'succeeded' })

    const resultat = await tick(plus(t0, 2 * SECONDE_MS), provider)

    expect(resultat).toMatchObject({ reclames: 0, interroges: 0, appliques: 0 })
    expect(faux.consultations).toHaveLength(0)
  })

  it('should extend once when the webhook arrives after the poll (same payment, duplicate)', async () => {
    const { user, provider, t0, chezMercy } = await paiementInitie({ status: 'succeeded' })
    await tick(plus(t0, 20 * SECONDE_MS), provider)
    const avant = await lireAbonnement(user.id)

    // Un second tick ne rejoue rien : le paiement est déjà terminé.
    const resultat = await tick(plus(t0, 40 * SECONDE_MS), provider)

    expect(resultat).toMatchObject({ interroges: 0, appliques: 0 })
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(avant?.expireLe.getTime())
    expect(chezMercy.id).toMatch(/^pay_/)
  })

  it.each([
    ['401', { type: 'http' as const, status: 401 }],
    ['429', { type: 'http' as const, status: 429, entetes: { 'Retry-After': '12' } }],
    ['500', { type: 'http' as const, status: 500 }],
  ])('should keep the payment open, count an error and log no key when Mercy answers %s', async (_libelle, scenario) => {
    journaux = espionnerJournaux()
    const { provider, paiement, t0 } = await paiementInitie({ status: 'succeeded' })
    faux.definirConsultation(scenario)

    const resultat = await tick(plus(t0, 20 * SECONDE_MS), provider)

    expect(resultat.appliques).toBe(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(journaux.contenu()).not.toContain(MERCY_TEST_CLE_API)
  })

  it('should never apply a Mercy answer whose metadata.paiement_id is not our payment (no cross-payment activation)', async () => {
    const { user, provider, paiement, t0, chezMercy } = await paiementInitie({ status: 'succeeded' })
    faux.modifierPaiement(chezMercy.id, { metadata: { paiement_id: '00000000-0000-4000-8000-000000000000' } })

    const resultat = await tick(plus(t0, 20 * SECONDE_MS), provider)

    expect(resultat.appliques).toBe(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })
})

describe('marquage manuel d’un paiement Mercy échoué (CA-M19)', () => {
  let connecte: AdminConnecte

  beforeEach(async () => {
    connecte = await installerAdmin()
  })
  afterEach(() => {
    desinstallerAdmin()
  })

  async function marquer(id: string) {
    const code = await codeMarquage(connecte.admin.id, id)
    return appelerAdmin(ROUTES.paiementMarquerPaye, connecte, {
      chemin: `/api/admin/paiements/${id}/marquer-paye`,
      methode: 'POST',
      params: { id },
      corps: { motif: MOTIF, cleIdempotence: cleIdempotence() },
      reauth: code,
    })
  }

  const echoueMercy = (userId: string, seed: Parameters<typeof insererPaiement>[1] = {}) =>
    insererPaiement(userId, {
      fournisseur: 'mercypay',
      source: 'fournisseur',
      statut: 'echoue',
      idFournisseur: null,
      referenceFournisseur: null,
      codeEchec: 'PAYMENT_NOT_APPROVED',
      operateur: 'MTN_MOMO_CMR',
      montantPlan: 5000,
      montant: 5000,
      periodeMois: 1,
      fraisTauxPb: 350,
      fraisEstimes: 175,
      netEstime: 4825,
      ...seed,
    })

  it('should accept the manual marking of a failed Mercy payment: a manual succeeded payment is created, the original is replaced, the subscription extended', async () => {
    const user = await createUser()
    const original = await echoueMercy(user.id)

    const reponse = await marquer(original.id)

    expect(reponse.status).toBe(200)
    const lignes = await lirePaiementsDe(user.id)
    const manuel = lignes.find((p) => p.source === 'manuel')
    expect(manuel).toMatchObject({ fournisseur: 'manuel', statut: 'reussi', montant: 5000, periodeMois: 1 })
    expect(lignes.find((p) => p.id === original.id)?.statut).toBe('anomalie')
    expect(await lireAbonnement(user.id)).toBeDefined()
  })

  it('should still accept a failed payment of the dormant K-PAY provider stored with the generic `fournisseur` source (D5)', async () => {
    const user = await createUser()
    const original = await echoueMercy(user.id, { fournisseur: 'kpay' })

    const reponse = await marquer(original.id)

    expect(reponse.status).toBe(200)
    expect((await lirePaiementsDe(user.id)).some((p) => p.source === 'manuel')).toBe(true)
  })

  it('should refuse (409 DEJA_PAYE) to mark a Mercy payment that already succeeded: never a second credit', async () => {
    const user = await createUser()
    const original = await echoueMercy(user.id, { statut: 'reussi', codeEchec: null, idFournisseur: 'pay_deja_paye' })

    const reponse = await marquer(original.id)

    expect(reponse.status).toBe(409)
    expect(reponse.code).toBe('DEJA_PAYE')
    expect((await lirePaiementsDe(user.id)).filter((p) => p.source === 'manuel')).toHaveLength(0)
  })
})
