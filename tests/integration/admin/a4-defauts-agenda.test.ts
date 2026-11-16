import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { vitrines } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import { ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import { ecrireReglage, reinitialiserA4 } from '../support/admin-a4'
import { createUser } from '../support/fabriques'

// A4 CA19 (D-A4-14) : les défauts d'agenda pilotés (préavis, horizon) s'appliquent aux NOUVELLES vitrines seulement ; une vitrine
// existante garde ses valeurs (ce sont des colonnes par vitrine, modifiées par son titulaire). Base réelle, écriture par la route.

const suite = preparerSuiteAdmin()

beforeEach(async () => {
  await reinitialiserA4()
})

const ligne = async (userId: string) => (await db.select({ preavis: vitrines.preavisHeures, horizon: vitrines.horizonJours }).from(vitrines).where(eq(vitrines.userId, userId)))[0]

describe('défauts d\'agenda des nouvelles vitrines (CA19)', () => {
  it('should give a vitrine created AFTER the change the new defaults (4 h, 90 days), and leave the existing vitrines untouched', async () => {
    const { createVitrine } = await import('../../../server/services/vitrines')
    const connecte = await ouvrirAdmin(suite.auth())
    const ancien = await createUser()
    await createVitrine(ancien.id, { titre: 'dr', prenom: 'Ancien', nom: 'Compte', metier: 'Médecin', username: 'dr-ancien' })
    expect(await ligne(ancien.id)).toEqual({ preavis: 2, horizon: 60 })

    expect((await ecrireReglage(connecte, 'agenda.preavis_defaut_heures', 4, { sansCode: true })).status).toBe(200)
    expect((await ecrireReglage(connecte, 'agenda.horizon_defaut_jours', 90, { sansCode: true })).status).toBe(200)
    const nouveau = await createUser()
    await createVitrine(nouveau.id, { titre: 'dr', prenom: 'Nouveau', nom: 'Compte', metier: 'Médecin', username: 'dr-nouveau' })

    expect(await ligne(nouveau.id)).toEqual({ preavis: 4, horizon: 90 })
    expect(await ligne(ancien.id)).toEqual({ preavis: 2, horizon: 60 })
  })
})
