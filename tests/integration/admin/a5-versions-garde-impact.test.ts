import { beforeEach, describe, expect, it } from 'vitest'
import { schemaImpactPlanDto } from '../../../shared/schemas/admin-versions'
import { preparerSuiteAdmin, ouvrirAdmin, journalDe } from '../support/admin'
import {
  activer,
  activerPlan,
  appelerA5,
  brouillon,
  lireVersions,
  preparerConfigurationA5,
  retourArriere,
  valeursGratuit,
  valeursPayant,
} from '../support/admin-a5'
import type { AdminA5 } from '../support/admin-a5'
import { ajouterServices, creerAbonne, viderServices } from '../support/abonnements'

// Garde d'impact des baisses de plan : (1) une version PROGRAMMÉE est revalidée (cohérence, impact) au moment où le job
// l'applique ; si l'impact acquitté n'est plus le même, elle n'est pas appliquée, elle est marquée non applicable
// (statut `remplacee`, jamais active) avec une ligne de journal ; (2) un retour arrière qui baisse des limites exige
// l'aperçu d'impact acquitté, comme une activation. VRAIE base, vrai journal, vraie réauthentification.

const suite = preparerSuiteAdmin()
preparerConfigurationA5()
let connecte: AdminA5

beforeEach(async () => {
  const { admin, cookie } = await ouvrirAdmin(suite.auth())
  connecte = { admin, cookie }
})

async function compteGratuit(nombreServices: number) {
  const pro = await creerAbonne('gratuit')
  await viderServices(pro.vitrine.id)
  await ajouterServices(pro.vitrine.id, nombreServices)
  return pro
}

const apercuServices = async (limite: number) => {
  const reponse = await appelerA5('plansImpact', connecte, { corps: { cle: 'gratuit', valeurs: valeursGratuit({ services: limite }) } })
  return schemaImpactPlanDto.parse(reponse.corps).impact
}

const demain = () => new Date(Date.now() + 24 * 3_600_000).toISOString()
const dansDeuxJours = () => new Date(Date.now() + 48 * 3_600_000)
const appliquer = async (maintenant: Date) => (await import('../../../server/services/configuration/versions')).appliquerVersionsProgrammees(maintenant)

describe('version programmée : revalidation à l\'application', () => {
  it('should apply a scheduled lowering when the impact is still the acknowledged one', async () => {
    await compteGratuit(5)
    await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 10 }))
    const v3 = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ services: 3 }))
    const impact = await apercuServices(3)
    const programmation = await activer(connecte, 'plans', v3, { programmeePour: demain(), impactAcquitte: impact })

    const appliquees = await appliquer(dansDeuxJours())

    expect(programmation.status).toBe(200)
    expect(appliquees).toBe(1)
    expect((await lireVersions('plan', 'gratuit')).find((v) => v.id === v3)?.statut).toBe('active')
  })

  it('should NOT apply a scheduled lowering whose impact changed since the acknowledgment : marked not applicable, journaled, the active version untouched', async () => {
    await compteGratuit(5)
    const v2 = await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 10 }))
    const v3 = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ services: 3 }))
    const impact = await apercuServices(3)
    await activer(connecte, 'plans', v3, { programmeePour: demain(), impactAcquitte: impact })
    await compteGratuit(4)

    const appliquees = await appliquer(dansDeuxJours())

    expect(appliquees).toBe(0)
    const versions = await lireVersions('plan', 'gratuit')
    expect(versions.find((v) => v.id === v2)?.statut).toBe('active')
    expect(versions.find((v) => v.id === v3)?.statut).toBe('remplacee')
    expect(versions.some((v) => v.statut === 'programmee')).toBe(false)
    const traces = (await journalDe('version.programmer')).filter((l) => l.apres?.statut === 'non_applicable')
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ cible_type: 'version', cible_id: v3, admin_id: connecte.admin.id, apres: { raison: 'IMPACT_CHANGE' } })
    expect(await appliquer(dansDeuxJours())).toBe(0)
  })

  it('should NOT apply a scheduled version that became incoherent with the other plan since it was scheduled', async () => {
    await activerPlan(connecte, 'payant', valeursPayant({ services: 20 }))
    const gratuit = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ services: 15 }))
    await activer(connecte, 'plans', gratuit, { programmeePour: demain() })
    await activerPlan(connecte, 'payant', valeursPayant({ services: 10 }))

    const appliquees = await appliquer(dansDeuxJours())

    expect(appliquees).toBe(0)
    expect((await lireVersions('plan', 'gratuit')).find((v) => v.id === gratuit)?.statut).toBe('remplacee')
    const traces = (await journalDe('version.programmer')).filter((l) => l.apres?.statut === 'non_applicable')
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ cible_id: gratuit, apres: { raison: 'COHERENCE' } })
  })
})

describe('retour arrière qui baisse des limites : impact acquitté exigé', () => {
  it('should answer 409 IMPACT_CHANGE without the acknowledged impact, change nothing, then succeed with it', async () => {
    const [v1] = await lireVersions('plan', 'gratuit')
    await compteGratuit(5)
    const v2 = await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 10 }))
    const impact = await apercuServices(3)

    const sans = await retourArriere(connecte, 'plans', v1!.id)
    const apresRefus = (await lireVersions('plan', 'gratuit')).map((v) => [v.id, v.statut])
    const perime = await retourArriere(connecte, 'plans', v1!.id, { impactAcquitte: { ...impact, services: { comptes: 9, elementsMasques: 9 } } })
    const avec = await retourArriere(connecte, 'plans', v1!.id, { impactAcquitte: impact })

    expect(sans).toMatchObject({ status: 409, code: 'IMPACT_CHANGE' })
    expect(perime).toMatchObject({ status: 409, code: 'IMPACT_CHANGE' })
    expect(apresRefus).toEqual([[v1!.id, 'remplacee'], [v2, 'active']])
    expect(avec.status).toBe(200)
    expect((await lireVersions('plan', 'gratuit')).map((v) => [v.id, v.statut])).toEqual([[v1!.id, 'active'], [v2, 'remplacee']])
    expect(await journalDe('version.retour')).toHaveLength(1)
  })

  it('should not demand an acknowledgment when the lowering touches nobody (nil impact), rolling back the active version', async () => {
    await compteGratuit(5)
    await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 10 }))
    const v3 = await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 12 }))

    const reponse = await retourArriere(connecte, 'plans', v3)

    expect(reponse.status).toBe(200)
  })
})
