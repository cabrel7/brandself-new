import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { schemaVersionReponse } from '../../../shared/schemas/admin-versions'
import { db } from '../../../server/utils/db'
import { ouvrirAdmin, preparerSuiteAdmin, journalDe } from '../support/admin'
import {
  activer,
  activerPlan,
  cleIdempotenceUnique,
  compterVersions,
  creerBrouillon,
  lireVersions,
  preparerConfigurationA5,
  valeursGratuit,
} from '../support/admin-a5'
import type { AdminA5 } from '../support/admin-a5'
import { erreurPostgres, rejet } from '../support/erreurs'

// A5 CA14 et CA15. CA14 : une version CRÉÉE ET ACTIVÉE PAR LE SERVICE est elle aussi en ajout seul (UPDATE du contenu,
// DELETE, TRUNCATE : 42501) ; la structure des déclencheurs et la version seedée sont éprouvées dans migration-0032.test.ts.
// CA15 : une clé d'idempotence rejouée relit la réponse journalisée, sans second effet. VRAIE base, vrai journal.

const suite = preparerSuiteAdmin()
preparerConfigurationA5()
let connecte: AdminA5

beforeEach(async () => {
  const { admin, cookie } = await ouvrirAdmin(suite.auth())
  connecte = { admin, cookie }
})

describe('versions en ajout seul (CA14)', () => {
  it.each([
    ['UPDATE du contenu', (id: string) => sql`UPDATE configuration_versions SET valeurs = '{"services":999}'::jsonb WHERE id = ${id}`],
    ['DELETE', (id: string) => sql`DELETE FROM configuration_versions WHERE id = ${id}`],
    ['TRUNCATE', () => sql`TRUNCATE TABLE configuration_versions`],
  ])('should refuse a %s on a version written by the service (42501) and keep every row intact', async (_operation, requete) => {
    const id = await activerPlan(connecte, 'gratuit', valeursGratuit({ statistiquesJours: 14 }))
    const avant = await lireVersions('plan', 'gratuit')

    const erreur = await rejet(db.execute(requete(id)))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe('42501')
    expect(await lireVersions('plan', 'gratuit')).toEqual(avant)
  })
})

describe('idempotence des écritures de version (CA15)', () => {
  it('should answer the same draft with rejoue=true and add no row nor journal line when the key is replayed, and refuse another body with the same key (409)', async () => {
    const cle = cleIdempotenceUnique()
    const valeurs = valeursGratuit({ statistiquesJours: 14 })

    const premiere = await creerBrouillon(connecte, 'plans', 'gratuit', valeurs, { cleIdempotence: cle })
    const total = await compterVersions()
    const rejeu = await creerBrouillon(connecte, 'plans', 'gratuit', valeurs, { cleIdempotence: cle })
    const conflit = await creerBrouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 21 }), { cleIdempotence: cle })

    const un = schemaVersionReponse.parse(premiere.corps)
    expect(un.rejoue).toBe(false)
    expect(schemaVersionReponse.parse(rejeu.corps)).toEqual({ ...un, rejoue: true })
    expect(conflit).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
    expect(await compterVersions()).toBe(total)
    expect(await journalDe('version.creer')).toHaveLength(1)
  })

  it('should not apply an activation twice when its key is replayed with a fresh code: same answer, one journal line, one active version', async () => {
    const [seed] = await lireVersions('plan', 'gratuit')
    const id = (await creerBrouillon(connecte, 'plans', 'gratuit', valeursGratuit({ statistiquesJours: 14 }))).corps as { version: { id: string } }
    const cle = cleIdempotenceUnique()

    const premiere = await activer(connecte, 'plans', id.version.id, { cleIdempotence: cle })
    const apresUne = await lireVersions('plan', 'gratuit')
    const rejeu = await activer(connecte, 'plans', id.version.id, { cleIdempotence: cle })

    expect(premiere.status).toBe(200)
    expect(rejeu.status).toBe(200)
    expect(schemaVersionReponse.parse(rejeu.corps)).toEqual({ ...schemaVersionReponse.parse(premiere.corps), rejoue: true })
    expect(await lireVersions('plan', 'gratuit')).toEqual(apresUne)
    expect(apresUne.map((v) => [v.id, v.statut])).toEqual([[seed!.id, 'remplacee'], [id.version.id, 'active']])
    expect(await journalDe('version.activer')).toHaveLength(1)
  })
})
