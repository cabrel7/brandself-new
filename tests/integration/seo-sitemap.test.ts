// S12 : tests d'intégration du sitemap (PG réel, aucune base mockée).
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { vitrines, services, realisations, users } from '../../shared/db/schema'
import { listerUrlsSitemap } from '../../server/services/seo-sitemap'
import { randomUUID } from 'node:crypto'
import { createUser } from './support/fabriques'

async function creerVitrine(username: string, publiee: boolean, metier = 'Cardiologue', updatedAt?: Date) {
  const user = await createUser()
  const [ligne] = await db
    .insert(vitrines)
    .values({
      id: randomUUID(),
      userId: user.id,
      username,
      titre: 'dr',
      prenom: 'Prenom',
      nom: 'Nom',
      metier,
      ville: 'Douala',
      pays: 'CM',
      publieeLe: publiee ? new Date('2026-01-01') : null,
      updatedAt: updatedAt ?? new Date('2026-01-01'),
    })
    .returning()
  return ligne
}

async function creerService(vitrineId: string, slug: string, actif = true, updatedAt?: Date) {
  const [ligne] = await db
    .insert(services)
    .values({
      id: randomUUID(),
      vitrineId,
      slug,
      titre: 'Service',
      type: 'rdv',
      dureeMin: 30,
      tarif: 'gratuit',
      actif,
      updatedAt: updatedAt ?? new Date('2026-01-01'),
    })
    .returning()
  return ligne
}

async function creerRealisation(vitrineId: string, slug: string, actif = true, updatedAt?: Date) {
  const [ligne] = await db
    .insert(realisations)
    .values({
      id: randomUUID(),
      vitrineId,
      slug,
      titre: 'Realisation',
      description: 'Desc',
      annee: 2025,
      actif,
      updatedAt: updatedAt ?? new Date('2026-01-01'),
    })
    .returning()
  return ligne
}

describe('sitemap (CA20-CA25)', () => {
  it('CA20 : vitrines publiées + éléments visibles, non-publiée exclue', async () => {
    const drCabrel = await creerVitrine('dr-cabrel', true, 'Cardiologue interventionnel')
    await creerVitrine('dr-cabrel-payant', true, 'Cardiologue')
    await creerVitrine('dr-cabrel-grace', true, 'Cardiologue')
    await creerVitrine('brouillon-x', false) // non publiée : exclue

    // 3 services visibles (plan gratuit = 3), 3 réalisations
    for (let i = 0; i < 3; i++) {
      await creerService(drCabrel.id, `service-${i}`, true)
      await creerRealisation(drCabrel.id, `realisation-${i}`, true)
    }

    const urls = await listerUrlsSitemap(new Date('2026-03-15T10:00:00Z'))
    const locs = urls.map((u) => u.loc)

    expect(locs).toContain('/dr-cabrel')
    expect(locs).toContain('/dr-cabrel/services')
    expect(locs).toContain('/dr-cabrel/services/service-0')
    expect(locs).toContain('/dr-cabrel/realisations')
    expect(locs).toContain('/dr-cabrel/realisations/realisation-0')
    expect(locs).not.toContain('/brouillon-x')
    expect(locs).not.toContain('/brouillon-x/services')
    expect(locs).not.toContain('@dr-cabrel')
    expect(locs).not.toContain('/agenda')
    expect(locs).not.toContain('/contact')
    expect(locs).not.toContain('/reserver')
  })

  it('CA21 : service inactif exclu ; vitrine sans réalisation visible', async () => {
    const vitrine = await creerVitrine('dr-service-inactif', true)
    await creerService(vitrine.id, 'service-actif', true)
    await creerService(vitrine.id, 'service-inactif', false)

    const urls = await listerUrlsSitemap(new Date('2026-03-15T10:00:00Z'))
    const locs = urls.map((u) => u.loc)
    expect(locs).toContain('/dr-service-inactif/services/service-actif')
    expect(locs).not.toContain('/dr-service-inactif/services/service-inactif')
    expect(locs).not.toContain('/dr-service-inactif/realisations')
  })

  it('CA23 : lastmod = max(service.updated_at, vitrine.updated_at)', async () => {
    const vitrine = await creerVitrine('dr-lastmod', true, 'Cardiologue', new Date('2026-01-01'))
    const _service = await creerService(vitrine.id, 'service-lastmod', true, new Date('2026-02-01'))

    const urls = await listerUrlsSitemap(new Date('2026-03-15T10:00:00Z'))
    const urlService = urls.find((u) => u.loc === '/dr-lastmod/services/service-lastmod')
    expect(urlService?.lastmod).toBe('2026-02-01T00:00:00.000Z')
  })

  it('CA24 : performance 50 vitrines, ≤ 5 s (machine de test)', async () => {
    const maintenant = new Date('2026-03-15T10:00:00Z')
    const userIds = Array.from({ length: 50 }, () => randomUUID())
    const lignesUsers = userIds.map((id) => ({
      id,
      name: 'Perf',
      email: `perf-${id}@exemple.com`,
      emailVerified: true,
    }))
    await db.insert(users).values(lignesUsers)
    const lignesVitrines = userIds.map((id, i) => ({
      id: randomUUID(),
      userId: id,
      username: `dr-perf-${i}`,
      titre: 'dr',
      prenom: 'P',
      nom: 'Nom',
      metier: 'Cardiologue',
      ville: 'Douala',
      pays: 'CM',
      publieeLe: maintenant,
      updatedAt: maintenant,
    }))
    await db.insert(vitrines).values(lignesVitrines)
    const debut = Date.now()
    const urls = await listerUrlsSitemap(maintenant)
    const duree = Date.now() - debut
    expect(duree).toBeLessThan(5000)
    expect(urls.length).toBe(50)
  })
})
