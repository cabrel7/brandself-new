import { beforeEach, describe, expect, it } from 'vitest'
import { ENTREE_ONBOARDING_DEMO } from '../../unit/support/ia-fixtures'
import { createUser } from '../support/fabriques'
import { creerSuperadmin } from '../support/admin'
import { creerGeneration, creerProviderScripte, iaGenerations, iaRepli, lireGeneration, reinitialiserIa } from '../support/ia'
import { poserReglage, reinitialiserA4 } from '../support/admin-a4'

// A4 CA07 (D-A4-10) : `ia.active=false` coupe l'IA à chaud : repli DÉTERMINISTE (jamais une vitrine vide), motif `ia_coupee`,
// ZÉRO appel au fournisseur, y compris si le job s'exécute ensuite. Base, Redis et file RÉELS ; seul le fournisseur est scripté.

beforeEach(async () => {
  await reinitialiserIa()
  await reinitialiserA4()
})

describe('IA coupée (CA07)', () => {
  it('should serve the deterministic fallback with the reason ia_coupee and never call the provider, even when the job runs afterwards', async () => {
    const { executeGeneration } = await iaGenerations()
    const { repliOnboarding } = await iaRepli()
    const createGeneration = await creerGeneration()
    const admin = await creerSuperadmin()
    const user = await createUser()
    await poserReglage('ia.active', false, admin.id)

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })
    const provider = creerProviderScripte(['valide'])
    await executeGeneration(ligne.id, { provider, now: Date.now, sleep: async () => undefined })

    const enBase = await lireGeneration(ligne.id)
    expect(enBase).toMatchObject({ statut: 'repli', motifRepli: 'ia_coupee' })
    expect(enBase?.sortie).toEqual(repliOnboarding(ENTREE_ONBOARDING_DEMO))
    expect(enBase?.termineeLe).toBeInstanceOf(Date)
    expect(provider.appels).toHaveLength(0)
  })
})
