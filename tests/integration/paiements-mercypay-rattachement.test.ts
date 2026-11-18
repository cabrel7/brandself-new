import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { redis } from '../../server/utils/redis'
import { demarrerFauxMercyPay, MERCY_TEST_CLE_API } from '../support/faux-mercypay'
import type { FauxMercyPay } from '../support/faux-mercypay'
import {
  initier,
  lireAbonnement,
  lireEvenements,
  lirePaiement,
  moduleAbonnements,
  plus,
  resumeEvenement,
  SECONDE_MS,
} from './support/abonnements'
import { createUser } from './support/fabriques'

// P1 (revue de sécurité) : une initiation INCERTAINE (délai dépassé, le paiement existe chez Mercy sans que son identifiant nous
// soit parvenu) ne doit pas laisser un client débité sans abonnement quand aucun webhook n'arrive. Le numéro de téléphone n'étant
// jamais conservé, on ne rejoue pas l'initiation : le rapprochement retrouve le paiement par NOTRE identifiant
// (`metadata.paiement_id`, liste `GET /payments?created[gte]=…`), pose l'identifiant, puis la vérification ordinaire applique le
// résultat. VRAIE base PostgreSQL, VRAI Redis ; seul le serveur Mercy est factice.

const ENTREE = { moyen: 'mercypay:MTN_MOMO_CMR', periodeMois: 1, prixAffiche: 5000 } as const
const DELAI_ATTENTE_S = 120

let faux: FauxMercyPay

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

async function providerMercy(delaiInitiationMs: number) {
  const { creerMercyPayProvider } = await import('../../server/services/paiements/fournisseurs/mercypay/adaptateur')
  return creerMercyPayProvider({ baseUrl: faux.baseUrl, cleApi: MERCY_TEST_CLE_API, environnement: 'test', delaiInitiationMs })
}

async function tick(now: Date, provider: Awaited<ReturnType<typeof providerMercy>>) {
  const { verifierPaiementsDus } = await moduleAbonnements()
  return verifierPaiementsDus(now, { getProvider: (nom) => (nom === 'mercypay' ? provider : null) })
}

/** Initiation dont la réponse arrive trop tard : le paiement EXISTE chez Mercy, notre ligne reste incertaine et sans identifiant. */
async function initiationIncertaine() {
  // Délais larges : sous charge, la requête peut mettre plusieurs centaines de ms à atteindre le faux serveur.
  faux.definirInitiation({ type: 'lent', delaiMs: 2_500 })
  const user = await createUser()
  const provider = await providerMercy(600)
  const t0 = new Date()
  const paiement = await initier(user.id, ENTREE, t0, { provider })
  expect(paiement).toMatchObject({ statut: 'en_attente', initiationIncertaine: true, idFournisseur: null })
  await vi.waitFor(() => expect(faux.paiements.size).toBe(1), { timeout: 10_000, interval: 50 })
  return { user, provider, paiement, t0, chezMercy: faux.dernierPaiement() }
}

describe('rattachement d’une initiation incertaine (CA-M06, revue P1)', () => {
  it('should not search before the webhook had time to arrive (120 s)', async () => {
    const { provider, paiement, t0 } = await initiationIncertaine()

    const resultat = await tick(plus(t0, 30 * SECONDE_MS), provider)

    expect(resultat).toMatchObject({ rattaches: 0, erreurs: 0 })
    expect(faux.listes).toHaveLength(0)
    expect(await lirePaiement(paiement.id)).toMatchObject({ idFournisseur: null, initiationIncertaine: true })
  })

  it('should find the payment by OUR identifier, attach its pay_ id, then let the ordinary verification apply the result', async () => {
    const { user, provider, paiement, t0, chezMercy } = await initiationIncertaine()
    faux.modifierPaiement(chezMercy.id, { status: 'succeeded' })

    const recherche = await tick(plus(t0, (DELAI_ATTENTE_S + 30) * SECONDE_MS), provider)

    // Même passage : rattachement (liste GET /payments), puis vérification ordinaire GET /payments/{id} qui applique le résultat.
    expect(recherche).toMatchObject({ rattaches: 1, appliques: 1, interroges: 1, erreurs: 0 })
    expect(faux.listes).toHaveLength(1)
    expect(faux.listes[0]?.chemin).toContain('created[gte]=')
    expect(faux.listes[0]?.entetes.authorization).toBe(`Bearer ${MERCY_TEST_CLE_API}`)
    expect(faux.consultations).toHaveLength(1)
    expect(await lirePaiement(paiement.id)).toMatchObject({
      idFournisseur: chezMercy.id,
      initiationIncertaine: false,
      statut: 'reussi',
      fraisReels: 175,
      netReel: 4825,
    })
    // Un second passage ne change rien : l'abonnement n'est activé qu'UNE fois.
    await tick(plus(t0, (DELAI_ATTENTE_S + 200) * SECONDE_MS), provider)
    expect(await lireAbonnement(user.id)).toBeDefined()
    const journal = (await lireEvenements()).map(resumeEvenement)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ source: 'interrogation', traitement: 'applique', paiementId: paiement.id })
  })

  it('should keep the payment pending (and retry later, not at every tick) when Mercy has no payment carrying our identifier', async () => {
    faux.definirInitiation({ type: 'silence' })
    const user = await createUser()
    const provider = await providerMercy(150)
    const t0 = new Date()
    const paiement = await initier(user.id, ENTREE, t0, { provider })
    expect(faux.paiements.size).toBe(0)

    const premier = await tick(plus(t0, (DELAI_ATTENTE_S + 30) * SECONDE_MS), provider)
    const deuxieme = await tick(plus(t0, (DELAI_ATTENTE_S + 40) * SECONDE_MS), provider)
    const troisieme = await tick(plus(t0, (DELAI_ATTENTE_S + 120) * SECONDE_MS), provider)

    expect(premier).toMatchObject({ rattaches: 0, erreurs: 0 })
    expect(deuxieme).toMatchObject({ rattaches: 0 })
    expect(troisieme).toMatchObject({ rattaches: 0 })
    // Une recherche à chaque minute au plus : le 2ᵉ tick (10 s après le 1ᵉʳ) n'a pas interrogé Mercy.
    expect(faux.listes).toHaveLength(2)
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'en_attente', idFournisseur: null, initiationIncertaine: true })
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should never attach the payment of ANOTHER customer (matching is by our identifier only, never by amount)', async () => {
    // Un autre client a un paiement du même montant chez Mercy ; le nôtre n'y est pas.
    faux.definirInitiation({ type: 'succes' })
    const autre = await createUser()
    const providerNormal = await providerMercy(5_000)
    await initier(autre.id, ENTREE, new Date(), { provider: providerNormal })
    expect(faux.paiements.size).toBe(1)

    faux.definirInitiation({ type: 'silence' })
    const user = await createUser()
    const providerCourt = await providerMercy(150)
    const t0 = new Date()
    const paiement = await initier(user.id, ENTREE, t0, { provider: providerCourt })

    const resultat = await tick(plus(t0, (DELAI_ATTENTE_S + 30) * SECONDE_MS), providerCourt)

    expect(resultat).toMatchObject({ rattaches: 0 })
    expect(await lirePaiement(paiement.id)).toMatchObject({ idFournisseur: null, initiationIncertaine: true })
  })

  it('should not search for a payment older than the idempotency window (24 h)', async () => {
    const { provider, paiement, t0 } = await initiationIncertaine()

    const resultat = await tick(plus(t0, 25 * 3600 * SECONDE_MS), provider)

    expect(resultat).toMatchObject({ rattaches: 0 })
    expect(faux.listes).toHaveLength(0)
    expect((await lirePaiement(paiement.id)).idFournisseur).toBeNull()
  })
})
