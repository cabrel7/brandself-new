// S11 : migration 0022 (statistiques) — contraintes SQL.
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { db } from '../../server/utils/db'
import { eq } from 'drizzle-orm'
import { vues, vitrines } from '../../shared/db/schema'
import { createUser } from './support/fabriques'

async function uneVitrine(username = `dr-mig-${randomUUID().slice(0, 6)}`) {
  const user = await createUser()
  const [vitrine] = await db
    .insert(vitrines)
    .values({
      id: randomUUID(),
      userId: user.id,
      username,
      titre: 'dr',
      prenom: 'Cabrel',
      nom: 'Nguesso',
      metier: 'Cardiologue',
      ville: 'Douala',
      pays: 'CM',
      publieeLe: new Date(),
    })
    .returning()
  if (!vitrine) throw new Error(`Vitrine non créée pour ${username}`)
  return vitrine
}

describe('migration 0022 : tables et contraintes', () => {
  it('les 4 tables existent et se lisent', async () => {
    await uneVitrine()
    expect(await db.select().from(vues)).toEqual([])
    expect(await db.select().from(vitrines)).toHaveLength(1)
  })

  it('CHECK empreinte : une IP brute est refusée (23514)', async () => {
    const vitrine = await uneVitrine('dr-mig-empreinte')
    let code = ''
    try {
      await db.insert(vues).values({
        id: 'ip-brute',
        vitrineId: vitrine.id,
        jour: new Date('2026-01-01'),
        empreinte: '203.0.113.7',
        pageType: 'accueil',
        pageIdentifiant: '',
        source: 'direct',
        appareil: 'mobile',
        pays: 'CM',
      })
    } catch (e) {
      code = String(
        (e as { cause?: { code?: string } }).cause?.code ??
          (e as { code?: string }).code ??
          '',
      )
    }
    expect(code).toBe('23514')
  })

  it('CHECK pays : minuscules refusées (23514)', async () => {
    const vitrine = await uneVitrine('dr-mig-pays')
    let code = ''
    try {
      await db.insert(vues).values({
        id: 'pays-brut',
        vitrineId: vitrine.id,
        jour: new Date('2026-01-01'),
        empreinte: 'a'.repeat(64),
        pageType: 'accueil',
        pageIdentifiant: '',
        source: 'direct',
        appareil: 'mobile',
        pays: 'cm',
      })
    } catch (e) {
      code = String(
        (e as { cause?: { code?: string } }).cause?.code ??
          (e as { code?: string }).code ??
          '',
      )
    }
    expect(code).toBe('23514')
  })

  it('CHECK page_identifiant : slug invalide refusé (23514)', async () => {
    const vitrine = await uneVitrine('dr-mig-slug')
    let code = ''
    try {
      await db.insert(vues).values({
        id: 'slug-brut',
        vitrineId: vitrine.id,
        jour: new Date('2026-01-01'),
        empreinte: 'b'.repeat(64),
        pageType: 'accueil',
        pageIdentifiant: 'Mon Slug',
        source: 'direct',
        appareil: 'mobile',
      })
    } catch (e) {
      code = String(
        (e as { cause?: { code?: string } }).cause?.code ??
          (e as { code?: string }).code ??
          '',
      )
    }
    expect(code).toBe('23514')
  })

  it('ligne valide insérée et lue', async () => {
    const vitrine = await uneVitrine('dr-mig-valide')
    await db.insert(vues).values({
      id: 'valide',
      vitrineId: vitrine.id,
      jour: new Date('2026-01-01'),
      empreinte: 'c'.repeat(64),
      pageType: 'service',
      pageIdentifiant: 'mon-service',
      source: 'google',
      appareil: 'mobile',
      pays: 'CM',
    })
    const [ligne] = await db.select().from(vues).where(eq(vues.id, 'valide'))
    expect(ligne.empreinte).toBe('c'.repeat(64))
    await db.delete(vues).where(eq(vues.id, 'valide'))
  })
})
