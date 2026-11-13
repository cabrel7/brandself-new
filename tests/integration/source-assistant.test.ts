import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { realisations, services } from '../../shared/db/schema'
import { schemaRealisationCreate } from '../../shared/schemas/realisation'
import { schemaServiceCreate } from '../../shared/schemas/service'
import { rejet } from './support/erreurs'
import { createUser } from './support/fabriques'
import { realisationsService, servicesService } from './support/modules'
import { creer as creerRealisation } from './support/realisations'
import { creer as creerService, creerVitrinePubliee } from './support/services'

// Vrai PostgreSQL, vraie couche service, vrais handlers d'outils MCP : aucun mock. Critère : `source = 'assistant'`
// est écrite par le service dans le MÊME INSERT que la ligne (atomique), jamais par un UPDATE ultérieur de l'outil,
// et l'API publique (schémas Zod) ne permet jamais de la fixer.

async function utilisateurAvecVitrine() {
  const user = await createUser()
  await creerVitrinePubliee(user)
  return user
}

const contexte = (userId: string) => ({ userId, vitrineId: 'v', assistantId: 'a', scopes: ['contenu:ecriture'] as ['contenu:ecriture'] })

describe('source du contenu : écrite par la couche service', () => {
  it('should persist source=assistant on the service row, inserted in one statement (no later UPDATE)', async () => {
    const user = await utilisateurAvecVitrine()
    const outil = await import('../../server/mcp/tools/creer-service')

    const resultat = await outil.executer({ titre: 'Brouillon assistant', type: 'rdv', dureeMin: 30, tarif: 'gratuit' }, contexte(user.id), {})

    const [ligne] = await db.select().from(services).where(eq(services.id, resultat.id))
    expect(ligne?.source).toBe('assistant')
    expect(ligne?.actif).toBe(false)
    expect(resultat.source).toBe('assistant')
    // Un UPDATE postérieur ferait avancer updated_at : les deux horodatages restent ceux de l'INSERT.
    expect(ligne?.updatedAt.getTime()).toBe(ligne?.createdAt.getTime())
  })

  it('should persist source=assistant on the realisation row, inserted in one statement (no later UPDATE)', async () => {
    const user = await utilisateurAvecVitrine()
    const outil = await import('../../server/mcp/tools/creer-realisation')

    const resultat = await outil.executer({ titre: 'Réalisation assistant' }, contexte(user.id))

    const [ligne] = await db.select().from(realisations).where(eq(realisations.id, resultat.id))
    expect(ligne?.source).toBe('assistant')
    expect(ligne?.actif).toBe(false)
    expect(ligne?.updatedAt.getTime()).toBe(ligne?.createdAt.getTime())
  })

  it('should leave NO row at all when the creation fails (no orphan row mistaken for user content)', async () => {
    const user = await utilisateurAvecVitrine()
    const { createService } = await servicesService()
    const { createRealisation } = await realisationsService()
    const mediaInconnu = '11111111-1111-4111-8111-111111111111'

    await rejet(createService(user.id, schemaServiceCreate.parse({ titre: 'X', type: 'rdv', dureeMin: 30, tarif: 'gratuit', imageMediaId: mediaInconnu }), undefined, undefined, 'assistant'))
    await rejet(createRealisation(user.id, schemaRealisationCreate.parse({ titre: 'X', imageMediaId: mediaInconnu }), undefined, 'assistant'))

    expect(await db.select().from(services)).toHaveLength(0)
    expect(await db.select().from(realisations)).toHaveLength(0)
  })

  it('should default to source=utilisateur through the studio path', async () => {
    const user = await utilisateurAvecVitrine()

    const s = await creerService(user.id)
    const r = await creerRealisation(user.id)

    expect(s.item.service.source).toBe('utilisateur')
    expect(r.item.realisation.source).toBe('utilisateur')
  })

  it('should never let the public input schemas carry a `source`', async () => {
    const service = schemaServiceCreate.safeParse({ titre: 'X', type: 'rdv', dureeMin: 30, tarif: 'gratuit', source: 'assistant' })
    const realisation = schemaRealisationCreate.safeParse({ titre: 'X', source: 'assistant' })

    for (const resultat of [service, realisation]) {
      if (resultat.success) expect(resultat.data).not.toHaveProperty('source')
      else expect(resultat.success).toBe(false)
    }
  })
})
