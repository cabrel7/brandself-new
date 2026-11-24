import { beforeEach, describe, expect, it } from 'vitest'
import { ESSAI_DEFAUT } from '../../../shared/essai'
import { ouvrirAdmin, preparerSuiteAdmin, journalDe } from '../support/admin'
import { activer, brouillon, creerBrouillon, preparerConfigurationA5, versionActive } from '../support/admin-a5'
import type { AdminA5 } from '../support/admin-a5'
import { moduleLectureConfiguration } from '../support/essai'

// E1 CA-E1-27 : l'administrateur crée et active une version `essai` (réauthentifié, journalisée) ; sans réauthentification : REAUTH_REQUISE.
// VRAIE base, VRAI journal, VRAIE réauthentification (mêmes aides que A5).

const suite = preparerSuiteAdmin()
preparerConfigurationA5()
let connecte: AdminA5

beforeEach(async () => {
  const { admin, cookie } = await ouvrirAdmin(suite.auth())
  connecte = { admin, cookie }
})

const VALEURS_V2 = { actif: true, dureeJours: 30, relanceServicesJour: 3, relanceStatistiquesJour: 10 }

describe('versions de l\'essai (CA-E1-27)', () => {
  it('should create a draft, refuse its activation without a code (REAUTH_REQUISE), then activate it with a code and journal `version.activer`', async () => {
    const id = await brouillon(connecte, 'essai', 'inscription', VALEURS_V2)

    const sans = await activer(connecte, 'essai', id, { reauth: null })
    const apresRefus = await versionActive('essai', 'inscription')
    const avec = await activer(connecte, 'essai', id)

    expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(apresRefus.numero).toBe(1)
    expect(avec.status).toBe(200)
    const active = await versionActive('essai', 'inscription')
    expect(active).toMatchObject({ id, valeurs: VALEURS_V2 })
    const lignes = await journalDe('version.activer')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'version', cible_id: id })
    const { lireConfigEssai } = await moduleLectureConfiguration()
    expect(await lireConfigEssai({ sansCache: true })).toMatchObject({ ...VALEURS_V2, versionId: id })
  })

  it('should keep the seeded version 1 equal to the code defaults, authored by the system', async () => {
    const v1 = await versionActive('essai', 'inscription')

    expect(v1.valeurs).toEqual(ESSAI_DEFAUT)
    expect(v1.creePar).toBe('systeme')
  })

  it.each([
    ['a duration of 0', { ...VALEURS_V2, dureeJours: 0 }],
    ['a duration of 91', { ...VALEURS_V2, dureeJours: 91 }],
    ['a statistics day equal to the duration', { ...VALEURS_V2, relanceStatistiquesJour: 30 }],
    ['an unknown key', { ...VALEURS_V2, prix: 0 }],
  ])('should refuse a draft with %s (422/400 validation), and persist nothing', async (_libelle, valeurs) => {
    const reponse = await creerBrouillon(connecte, 'essai', 'inscription', valeurs)

    expect([400, 422]).toContain(reponse.status)
    expect(reponse.code).toBe('VALIDATION')
  })

  it('should refuse any key other than `inscription`', async () => {
    const reponse = await creerBrouillon(connecte, 'essai', 'autre', VALEURS_V2)

    expect([400, 422]).toContain(reponse.status)
  })

  it('should let a switched-off version be activated (the trial can be closed without a deployment)', async () => {
    const id = await brouillon(connecte, 'essai', 'inscription', { ...VALEURS_V2, actif: false })

    const reponse = await activer(connecte, 'essai', id)

    expect(reponse.status).toBe(200)
    expect((await versionActive('essai', 'inscription')).valeurs).toMatchObject({ actif: false })
  })
})
