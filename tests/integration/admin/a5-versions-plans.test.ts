import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { VERSIONS_APPLIQUER_INTERVALLE_MS, VERSIONS_APPLIQUER_SCHEDULER_ID } from '../../../shared/jobs'
import { schemaImpactPlanDto, schemaVersionReponse } from '../../../shared/schemas/admin-versions'
import { db } from '../../../server/utils/db'
import { avecJournalEnPanne, ouvrirAdmin, preparerSuiteAdmin, journalDe } from '../support/admin'
import {
  DELAI_CACHE_MS,
  MOTIF_A5,
  activer,
  activerPlan,
  appelerA5,
  brouillon,
  codeReauthVersion,
  compterVersions,
  creerBrouillon,
  lireVersions,
  preparerConfigurationA5,
  retourArriere,
  valeursGratuit,
  valeursPayant,
  versionActive,
} from '../support/admin-a5'
import type { AdminA5 } from '../support/admin-a5'
import { ajouterServices, compter, creerAbonne, viderServices } from '../support/abonnements'
import { servicesService } from '../support/modules'

// A5 CA03, CA04, CA11, CA12, CA13 + réauthentification, statuts et concurrence des versions de PLAN. VRAIE base, vrais
// verrous, vrai journal, vraie réauthentification ; seule l'horloge est celle du système (le cache de lecture de 5 s,
// D-A5-04, est attendu par `vi.waitFor`, jamais contourné). L'identifiant `id` de `retour` désigne la version à RESTAURER.

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

async function servicesPublics(username: string): Promise<number> {
  const { getPublicServices } = await servicesService()
  return (await getPublicServices(username)).services.length
}

/** Attend que le masquage public reflète le plan (lecture mise en cache 5 s : R6 de la spec). */
const attendreServicesPublics = (username: string, attendu: number) =>
  vi.waitFor(async () => expect(await servicesPublics(username)).toBe(attendu), { timeout: DELAI_CACHE_MS, interval: 400 })

const apercuServices = async (limite: number) => {
  const reponse = await appelerA5('plansImpact', connecte, { corps: { cle: 'gratuit', valeurs: valeursGratuit({ services: limite }) } })
  return schemaImpactPlanDto.parse(reponse.corps).impact
}

describe('baisse de limite : aperçu, masquage, retour arrière (CA03)', () => {
  it('should preview comptes=1 and elements_masques=2, hide the 2 excess services publicly after activation without deleting them, and show them again after the rollback', async () => {
    const gros = await compteGratuit(5)
    await compteGratuit(3)
    const v2 = await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 10 }))
    await attendreServicesPublics(gros.vitrine.username, 5)

    const impact = await apercuServices(3)
    const v3 = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ services: 3 }))
    const activation = await activer(connecte, 'plans', v3, { impactAcquitte: impact })

    expect(impact.services).toEqual({ comptes: 1, elementsMasques: 2 })
    expect(activation.status).toBe(200)
    expect(schemaVersionReponse.parse(activation.corps)).toMatchObject({ rejoue: false, version: { id: v3, statut: 'active' } })
    await attendreServicesPublics(gros.vitrine.username, 3)
    expect(await compter('services', gros.vitrine.id)).toBe(5)

    const retour = await retourArriere(connecte, 'plans', v2)

    expect(retour.status).toBe(200)
    await attendreServicesPublics(gros.vitrine.username, 5)
    expect(await compter('services', gros.vitrine.id)).toBe(5)
  }, 60_000)
})

describe('impact acquitté périmé ou absent (CA04)', () => {
  it.each([
    ['périmé : un compte gratuit est apparu après l\'aperçu', true],
    ['absent : la baisse est envoyée sans aperçu', false],
  ])('should answer 409 IMPACT_CHANGE with the current impact and change nothing when the acknowledged impact is %s', async (_cas, avecApercuPerime) => {
    await compteGratuit(5)
    await activerPlan(connecte, 'gratuit', valeursGratuit({ services: 10 }))
    const v3 = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ services: 3 }))
    const apercu = await apercuServices(3)
    if (avecApercuPerime) await compteGratuit(4)

    const reponse = await activer(connecte, 'plans', v3, avecApercuPerime ? { impactAcquitte: apercu } : {})

    expect(reponse).toMatchObject({ status: 409, code: 'IMPACT_CHANGE' })
    const courant = (reponse.data as { impact?: { services?: unknown } } | undefined)?.impact?.services
    expect(courant).toEqual(avecApercuPerime ? { comptes: 2, elementsMasques: 3 } : { comptes: 1, elementsMasques: 2 })
    expect((await lireVersions('plan', 'gratuit')).map((v) => v.statut)).toEqual(['remplacee', 'active', 'brouillon'])
    expect(await journalDe('version.activer')).toHaveLength(1)
  })
})

describe('retour arrière réauthentifié (CA11)', () => {
  it('should answer REAUTH_REQUISE without a code, then restore the previous version and mark the current one replaced, journaled', async () => {
    const [v1] = await lireVersions('plan', 'gratuit')
    const v2 = await activerPlan(connecte, 'gratuit', valeursGratuit({ statistiquesJours: 14 }))

    const sans = await retourArriere(connecte, 'plans', v1!.id, { reauth: null })
    const apres = (await lireVersions('plan', 'gratuit')).map((v) => v.statut)
    const avec = await retourArriere(connecte, 'plans', v1!.id)

    expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(apres).toEqual(['remplacee', 'active'])
    expect(avec.status).toBe(200)
    expect((await lireVersions('plan', 'gratuit')).map((v) => [v.id, v.statut])).toEqual([[v1!.id, 'active'], [v2, 'remplacee']])
    const lignes = await journalDe('version.retour')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'version', cible_id: v1!.id, motif: MOTIF_A5 })
  })
})

describe('activation réauthentifiée et statuts (D-A5-02)', () => {
  it('should refuse an activation without code (REAUTH_REQUISE) or with the code of ANOTHER version (REAUTH_INVALIDE), and change nothing', async () => {
    const cible = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 14 }))
    const autre = await brouillon(connecte, 'plans', 'payant', valeursPayant({ statistiquesJours: 60 }))
    const codeAutre = await codeReauthVersion(connecte.admin.id, 'versionActiver', autre)

    const sans = await activer(connecte, 'plans', cible, { reauth: null })
    const mauvaiseCible = await activer(connecte, 'plans', cible, { reauth: codeAutre })

    expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(mauvaiseCible).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lireVersions('plan', 'gratuit')).map((v) => v.statut)).toEqual(['active', 'brouillon'])
    expect(await journalDe('version.activer')).toHaveLength(0)
  })

  it('should answer 422 VERSION_NON_ACTIVABLE for a version already active or already replaced (only a draft or a scheduled version is activated)', async () => {
    const [v1] = await lireVersions('plan', 'gratuit')
    const v2 = await activerPlan(connecte, 'gratuit', valeursGratuit({ statistiquesJours: 14 }))

    const dejaActive = await activer(connecte, 'plans', v2)
    const remplacee = await activer(connecte, 'plans', v1!.id)

    expect(dejaActive).toMatchObject({ status: 422, code: 'VERSION_NON_ACTIVABLE' })
    expect(remplacee).toMatchObject({ status: 422, code: 'VERSION_NON_ACTIVABLE' })
    expect((await lireVersions('plan', 'gratuit')).map((v) => v.statut)).toEqual(['remplacee', 'active'])
  })

  it('should refuse a free plan whose limit exceeds the paid plan, and keep the active free plan unchanged', async () => {
    // Rendre une limite du plan payant FINIE est une baisse : l'impact doit être acquitté.
    const apercuPayant = await appelerA5('plansImpact', connecte, { corps: { cle: 'payant', valeurs: valeursPayant({ services: 20 }) } })
    await activerPlan(connecte, 'payant', valeursPayant({ services: 20 }), { impactAcquitte: schemaImpactPlanDto.parse(apercuPayant.corps).impact })
    const avant = await versionActive('plan', 'gratuit')

    const creation = await creerBrouillon(connecte, 'plans', 'gratuit', valeursGratuit({ services: 30 }))
    const activation = creation.status === 200 ? await activer(connecte, 'plans', (creation.corps as { version: { id: string } }).version.id) : creation

    // Refus de validation : 400 VALIDATION (ValidationError du dépôt), à la création ou à l'activation.
    expect(activation).toMatchObject({ status: 400, code: 'VALIDATION' })
    expect(await versionActive('plan', 'gratuit')).toEqual(avant)
  })

  it('should end with exactly ONE active version (no 500) when two drafts of the same plan are activated at once', async () => {
    const a = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 14 }))
    const b = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 21 }))
    // Codes demandés l'un après l'autre : `demanderEtLireCode` relit la DERNIÈRE ligne de réauthentification de l'administrateur.
    const codes = [await codeReauthVersion(connecte.admin.id, 'versionActiver', a), await codeReauthVersion(connecte.admin.id, 'versionActiver', b)]

    const reponses = await Promise.all([activer(connecte, 'plans', a, { reauth: codes[0] }), activer(connecte, 'plans', b, { reauth: codes[1] })])

    for (const r of reponses) expect([200, 409, 422], `${r.status} ${r.code}`).toContain(r.status)
    const versions = await lireVersions('plan', 'gratuit')
    expect(versions.filter((v) => v.statut === 'active')).toHaveLength(1)
    expect(versions.filter((v) => v.statut === 'brouillon').length + versions.filter((v) => v.statut === 'remplacee').length).toBe(versions.length - 1)
  })
})

describe('date d\'effet : job versions-appliquer (CA12)', () => {
  it('should activate a scheduled version whose date has passed by less than 60 s, leave a future one scheduled, and be idempotent', async () => {
    const echue = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 14 }))
    const future = await brouillon(connecte, 'plans', 'payant', valeursPayant({ statistiquesJours: 60 }))
    const demain = new Date(Date.now() + 24 * 3_600_000).toISOString()
    const programmation = await activer(connecte, 'plans', future, { programmeePour: demain })
    await db.execute(sql`UPDATE configuration_versions SET statut = 'programmee', effective_a = now() - interval '30 seconds' WHERE id = ${echue}`)
    const { appliquerVersionsProgrammees } = await import('../../../server/services/configuration/versions')

    await appliquerVersionsProgrammees()
    const apresUn = await lireVersions('plan', 'gratuit')
    await appliquerVersionsProgrammees()
    const apresDeux = await lireVersions('plan', 'gratuit')

    expect(programmation.status).toBe(200)
    expect((await lireVersions('plan', 'payant')).map((v) => v.statut)).toEqual(['active', 'programmee'])
    expect(apresUn.map((v) => v.statut)).toEqual(['remplacee', 'active'])
    expect(apresUn.find((v) => v.statut === 'active')?.id).toBe(echue)
    expect(apresDeux).toEqual(apresUn)
    expect(await journalDe('version.programmer')).toHaveLength(1)
  })

  it('should be scheduled every 60 seconds under a fixed scheduler id (idempotent upsert)', async () => {
    const { planifierVersionsAppliquer } = await import('../../../server/jobs/versions-appliquer')
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined)

    await planifierVersionsAppliquer({ upsertJobScheduler })

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    expect(upsertJobScheduler.mock.calls[0]?.[0]).toBe(VERSIONS_APPLIQUER_SCHEDULER_ID)
    expect(upsertJobScheduler.mock.calls[0]?.[1]).toMatchObject({ every: VERSIONS_APPLIQUER_INTERVALLE_MS })
  })
})

describe('atomicité : un journal en panne ne laisse rien changer (CA13)', () => {
  it('should leave the version a draft, the previous one active and nothing journaled when the journal write fails', async () => {
    const cible = await brouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 14 }))
    const avant = await compterVersions()

    const reponse = await avecJournalEnPanne(() => activer(connecte, 'plans', cible))

    expect(reponse.status).not.toBe(200)
    expect((await lireVersions('plan', 'gratuit')).map((v) => v.statut)).toEqual(['active', 'brouillon'])
    expect(await compterVersions()).toBe(avant)
    expect(await journalDe('version.activer')).toHaveLength(0)
  })
})
