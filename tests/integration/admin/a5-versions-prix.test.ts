import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ouvrirAdmin, preparerSuiteAdmin, journalDe } from '../support/admin'
import {
  DELAI_CACHE_MS,
  activer,
  brouillon,
  grillePrix,
  preparerConfigurationA5,
  validerPrix,
  versionActive,
} from '../support/admin-a5'
import type { AdminA5 } from '../support/admin-a5'
import { appliquer, compter, corpsPour, initier, lirePaiement } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { rejet } from '../support/erreurs'

// A5 CA05, CA06, CA07 (+ D-A5-07, D-A5-08) : versions de PRIX, de moyens. VRAIE base, VRAI journal, VRAIE réauthentification,
// VRAI adaptateur K-PAY sur le faux serveur local. Seul `NODE_ENV` est simulé (production) dans CA07, le temps d'un appel :
// la grille seedée n'est PAS validée, la production reste verrouillée comme avant la migration.

const mode = vi.hoisted(() => ({ production: false }))
vi.mock('../../../shared/env', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../../shared/env')>()
  return { ...reel, env: new Proxy(reel.env, { get: (cible, cle) => (cle === 'NODE_ENV' && mode.production ? 'production' : Reflect.get(cible, cle)) }) }
})

const suite = preparerSuiteAdmin()
preparerConfigurationA5()
let connecte: AdminA5

const PRIX_P1_XAF_12 = 48_000
const PRIX_P2_XAF_12 = 54_000

beforeEach(async () => {
  mode.production = false
  const { admin, cookie } = await ouvrirAdmin(suite.auth())
  connecte = { admin, cookie }
})

/** Active une grille P2 (réauthentifié) : l'activation d'un prix la VALIDE dans la même transaction (D-A5-07). */
async function activerGrilleP2(): Promise<string> {
  const id = await brouillon(connecte, 'prix', 'payant', grillePrix(PRIX_P2_XAF_12))
  const reponse = await activer(connecte, 'prix', id)
  if (reponse.status !== 200) throw new Error(`Activation de la grille attendue réussie, reçu ${reponse.status} ${reponse.code ?? ''}`)
  return id
}

describe('changement de grille : paiement initié, prix affiché (CA05, CA06)', () => {
  it('should keep the price of a payment initiated before the new grid, and still verify its webhook against it (CA05)', async () => {
    const user = await createUser()
    const paiement = await initier(user.id, {})

    await activerGrilleP2()
    const lu = await lirePaiement(paiement.id)
    const webhook = await appliquer(corpsPour(paiement))

    expect(paiement.montantPlan).toBe(PRIX_P1_XAF_12)
    expect(lu).toMatchObject({ montant: PRIX_P1_XAF_12, montantPlan: PRIX_P1_XAF_12 })
    expect(webhook).toMatchObject({ traitement: 'applique', paiementId: paiement.id })
  })

  it('should answer 409 PRIX_CHANGE with the new amount and create no payment when the displayed price is the old one, then accept the new one (CA06)', async () => {
    const user = await createUser()
    const grille = await activerGrilleP2()

    const refuse = await rejet(initier(user.id, { prixAffiche: PRIX_P1_XAF_12 }))
    const aucun = await compter('paiements')
    const accepte = await initier(user.id, { prixAffiche: PRIX_P2_XAF_12 })

    expect(refuse).toMatchObject({ status: 409, code: 'PRIX_CHANGE', data: { prixActuel: PRIX_P2_XAF_12, devise: 'XAF' } })
    expect(aucun).toBe(0)
    expect(accepte).toMatchObject({ montantPlan: PRIX_P2_XAF_12, statut: 'en_attente' })
    expect((await versionActive('prix', 'payant')).id).toBe(grille)
  })
})

describe('grille seedée non validée en production (CA07, D-A5-07)', () => {
  it('should answer 503 PAIEMENT_INDISPONIBLE and create nothing in production while the seeded grid is not validated, and unlock once a grid is activated', async () => {
    const user = await createUser()
    const seed = await versionActive('prix', 'payant')
    mode.production = true

    const verrouille = await rejet(initier(user.id, {}))
    const lignes = await compter('paiements')
    mode.production = false
    await activerGrilleP2()
    mode.production = true
    const apres = await initier(user.id, { prixAffiche: PRIX_P2_XAF_12 }).then(() => null, (erreur: unknown) => erreur as { code?: string })

    expect(seed.valideeLe).toBeNull()
    expect(verrouille).toMatchObject({ status: 503, code: 'PAIEMENT_INDISPONIBLE' })
    expect(lignes).toBe(0)
    expect(apres?.code).not.toBe('PAIEMENT_INDISPONIBLE')
  })

  it('should validate the ACTIVE grid without changing it, only with a fresh reauthentication code, and journal it', async () => {
    const seed = await versionActive('prix', 'payant')

    const sans = await validerPrix(connecte, seed.id, { reauth: null })
    const apresRefus = await versionActive('prix', 'payant')
    const avec = await validerPrix(connecte, seed.id)

    expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(apresRefus.valideeLe).toBeNull()
    expect(avec.status).toBe(200)
    const validee = await versionActive('prix', 'payant')
    expect(validee.valideeLe).not.toBeNull()
    expect(validee.valeurs).toEqual(seed.valeurs)
    expect(validee.id).toBe(seed.id)
    const lignes = await journalDe('version.valider_prix')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'version', cible_id: seed.id })
  })
})

describe('moyens de paiement : le drapeau change sans redéploiement (D-A5-08)', () => {
  it('should refuse a method removed from the active ones (422 MOYEN_PAIEMENT_INVALIDE) within the read cache delay, and keep the other one working', async () => {
    const id = await brouillon(connecte, 'moyens', 'kpay', { actifs: ['kpay:MTN_MOMO_CMR'] })
    const activation = await activer(connecte, 'moyens', id)
    let essai = 0

    await vi.waitFor(async () => {
      essai += 1
      const visiteur = await createUser()
      const erreur = await rejet(initier(visiteur.id, { moyen: 'kpay:ORANGE_CMR', telephone: `69${String(essai).padStart(7, '0')}` }))
      expect(erreur).toMatchObject({ status: 422, code: 'MOYEN_PAIEMENT_INVALIDE' })
    }, { timeout: DELAI_CACHE_MS, interval: 400 })

    expect(activation.status).toBe(200)
    const autre = await createUser()
    expect(await initier(autre.id, {})).toMatchObject({ statut: 'en_attente', operateur: 'MTN_MOMO_CMR' })
  }, 40_000)
})
