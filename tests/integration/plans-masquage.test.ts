import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { services } from '../../shared/db/schema'
import type { realisations, temoignages } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { corpsPour, creerAbonne, ajouterRealisations, ajouterServices, ajouterTemoignages, compter, insererPaiement, recevoir, viderServices } from './support/abonnements'
import { rejet } from './support/erreurs'
import { insertService } from './support/fabriques'
import { modifier } from './support/services'
import { servicesService, vitrinesService, realisationsService } from './support/modules'

// S10 §6 CA64 à CA67, CA70, CA91 à CA94 et #127, #128 : masquage public au-delà de la limite du plan, badge. VRAIE base.
// Au-delà de la limite, seuls les N plus ANCIENS éléments actifs restent visibles ; rien n'est jamais supprimé ni modifié ;
// la réapparition est automatique au renouvellement. Le statut d'abonnement n'est jamais exposé publiquement.

const temoignagesService = () => import('../../server/services/temoignages')

async function instantane(table: typeof services | typeof realisations | typeof temoignages, vitrineId: string): Promise<string> {
  const lignes = await db.select().from(table).where(eq(table.vitrineId, vitrineId))
  return JSON.stringify(lignes.sort((a, b) => a.id.localeCompare(b.id)))
}

async function cinqServices(etat: 'gratuit' | 'actif' | 'grace' | 'termine') {
  const pro = await creerAbonne(etat)
  await viderServices(pro.vitrine.id)
  const lignes = await ajouterServices(pro.vitrine.id, 4)
  const vedette = await insertService(pro.vitrine.id, { titre: 'Service 5', enVedette: true, createdAt: new Date('2026-01-06T08:00:00.000Z'), ordre: 4 })
  return { pro, lignes: [...lignes, vedette] }
}

describe('services : retour au gratuit sans suppression (CA65)', () => {
  it('should show the 3 oldest services, hide the other 2 and keep the 5 rows untouched', async () => {
    const { pro, lignes } = await cinqServices('termine')
    const { getPublicServices, getPublicService } = await servicesService()
    const avant = await instantane(services, pro.vitrine.id)

    const publics = await getPublicServices(pro.vitrine.username)
    const detailMasque = await rejet(getPublicService(pro.vitrine.username, lignes[3]!.slug))
    const detailVisible = await getPublicService(pro.vitrine.username, lignes[2]!.slug)

    expect(publics.services.map((s) => s.service.titre)).toEqual(['Service 1', 'Service 2', 'Service 3'])
    expect(detailMasque).toMatchObject({ code: 'SERVICE_INTROUVABLE', status: 404 })
    expect(detailVisible.item.service.id).toBe(lignes[2]!.id)
    expect(await compter('services', pro.vitrine.id)).toBe(5)
    expect(await instantane(services, pro.vitrine.id)).toBe(avant)
  })

  it('should count 3 in the navigation of the public page and keep the masked featured service out of "à la une" (CA65, CA94)', async () => {
    const { pro } = await cinqServices('termine')
    const { getPublicVitrinePage } = await vitrinesService()
    const { getPublicServices } = await servicesService()

    const page = await getPublicVitrinePage(pro.vitrine.username)
    const publics = await getPublicServices(pro.vitrine.username)

    expect(page.contenus.services).toBe(3)
    expect(publics.aLaUne.map((s) => s.service.titre)).not.toContain('Service 5')
    expect(publics.total).toBe(3)
  })

  it('should keep every service visible during the active period and during the grace period', async () => {
    for (const etat of ['actif', 'grace'] as const) {
      const { pro } = await cinqServices(etat)
      const { getPublicServices } = await servicesService()

      const publics = await getPublicServices(pro.vitrine.username)

      expect(publics.services).toHaveLength(5)
      expect(publics.total).toBe(5)
    }
  })

  it('should keep every service visible for a user who never paid when the limit is not reached', async () => {
    const pro = await creerAbonne('gratuit')
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, 3)
    const { getPublicServices } = await servicesService()

    expect((await getPublicServices(pro.vitrine.username)).services).toHaveLength(3)
  })
})

describe('réapparition au renouvellement (CA66) et libération par le propriétaire (CA67)', () => {
  it('should show the 5 services again after a confirmed payment, without any write on `services`', async () => {
    const { pro } = await cinqServices('termine')
    const { getPublicServices } = await servicesService()
    const avant = await instantane(services, pro.vitrine.id)
    expect((await getPublicServices(pro.vitrine.username)).services).toHaveLength(3)
    const paiement = await insererPaiement(pro.user.id)

    await recevoir(corpsPour(paiement), { now: new Date() })

    const apres = await getPublicServices(pro.vitrine.username)
    expect(apres.services).toHaveLength(5)
    expect(await instantane(services, pro.vitrine.id)).toBe(avant)
  })

  it('should make the next services visible when the owner hides an old one (the user keeps control) (CA67)', async () => {
    const { pro, lignes } = await cinqServices('termine')
    const { getPublicServices } = await servicesService()

    await modifier(pro.user.id, lignes[0]!.id, { actif: false })

    const publics = await getPublicServices(pro.vitrine.username)
    expect(publics.services.map((s) => s.service.titre)).toEqual(['Service 2', 'Service 3', 'Service 4'])
  })

  it('should order the visible services by the display order, not by age, while choosing the oldest (#127)', async () => {
    const pro = await creerAbonne('termine')
    await viderServices(pro.vitrine.id)
    const [a, b, c] = await ajouterServices(pro.vitrine.id, 3)
    await insertService(pro.vitrine.id, { titre: 'Récent', createdAt: new Date('2026-06-01T08:00:00.000Z'), ordre: 0 })
    await db.update(services).set({ ordre: 5 }).where(eq(services.id, a!.id))
    await db.update(services).set({ ordre: 1 }).where(eq(services.id, b!.id))
    await db.update(services).set({ ordre: 3 }).where(eq(services.id, c!.id))
    const { getPublicServices } = await servicesService()

    const publics = await getPublicServices(pro.vitrine.username)

    expect(publics.services.map((s) => s.service.titre)).toEqual(['Service 2', 'Service 3', 'Service 1'])
  })
})

describe('liste du studio : étiquette et compteurs (CA70)', () => {
  it('should flag the 4th and 5th services as masked by the plan and report a limit reached 3/5', async () => {
    const { pro } = await cinqServices('gratuit')
    const { listOwnServices } = await servicesService()

    const { items, compteurs } = await listOwnServices(pro.user.id)

    const masques = items.filter((i) => i.service.masqueParPlan).map((i) => i.service.titre).sort()
    expect(masques).toEqual(['Service 4', 'Service 5'])
    expect(compteurs.limitePlan).toEqual({ limite: 3, utilise: 5, atteinte: true })
  })

  it('should flag nothing and report no limit for a payer', async () => {
    const { pro } = await cinqServices('actif')
    const { listOwnServices } = await servicesService()

    const { items, compteurs } = await listOwnServices(pro.user.id)

    expect(items.some((i) => i.service.masqueParPlan)).toBe(false)
    expect(compteurs.limitePlan).toEqual({ limite: null, utilise: 5, atteinte: false })
  })

  it('should not flag an element that the owner already switched off', async () => {
    const pro = await creerAbonne('gratuit')
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, 3)
    await insertService(pro.vitrine.id, { titre: 'Éteint', actif: false, createdAt: new Date('2026-02-01T08:00:00.000Z') })
    const { listOwnServices } = await servicesService()

    const { items } = await listOwnServices(pro.user.id)

    expect(items.find((i) => i.service.titre === 'Éteint')?.service.masqueParPlan).toBe(false)
  })
})

describe('réalisations et témoignages (CA92)', () => {
  it('should list the 3 oldest realisations and answer 404 for the detail of a masked one', async () => {
    const pro = await creerAbonne('termine')
    const lignes = await ajouterRealisations(pro.vitrine.id, 5)
    const { getPublicRealisations, getPublicRealisation } = await realisationsService()

    const publiques = await getPublicRealisations(pro.vitrine.username)
    const masquee = await rejet(getPublicRealisation(pro.vitrine.username, lignes[3]!.slug))

    expect(publiques.realisations.map((r) => r.realisation.titre)).toEqual(['Réalisation 1', 'Réalisation 2', 'Réalisation 3'])
    expect(masquee).toMatchObject({ code: 'REALISATION_INTROUVABLE', status: 404 })
    expect(await compter('realisations', pro.vitrine.id)).toBe(5)
  })

  it('should list the 3 oldest testimonials and keep the 5 rows', async () => {
    const pro = await creerAbonne('termine')
    await ajouterTemoignages(pro.vitrine.id, 5)
    const { getPublicTemoignages } = await temoignagesService()

    const publics = await getPublicTemoignages(pro.vitrine.username)

    expect(publics.temoignages.map((t) => t.auteur)).toEqual(['Auteur 1', 'Auteur 2', 'Auteur 3'])
    expect(await compter('temoignages', pro.vitrine.id)).toBe(5)
  })

  it('should show everything again for a payer', async () => {
    const pro = await creerAbonne('actif')
    await ajouterTemoignages(pro.vitrine.id, 5)
    await ajouterRealisations(pro.vitrine.id, 5)
    const { getPublicTemoignages } = await temoignagesService()
    const { getPublicRealisations } = await realisationsService()

    expect((await getPublicTemoignages(pro.vitrine.username)).temoignages).toHaveLength(5)
    expect((await getPublicRealisations(pro.vitrine.username)).realisations).toHaveLength(5)
  })
})

describe('badge Brandself et confidentialité du plan (CA91)', () => {
  it('should show the badge for a free vitrine and hide it for an active one and one in grace', async () => {
    const { getPublicVitrinePage } = await vitrinesService()
    const gratuit = await creerAbonne('gratuit')
    const actif = await creerAbonne('actif')
    const grace = await creerAbonne('grace')
    const termine = await creerAbonne('termine')

    expect((await getPublicVitrinePage(gratuit.vitrine.username)).badgeBrandself).toBe(true)
    expect((await getPublicVitrinePage(actif.vitrine.username)).badgeBrandself).toBe(false)
    expect((await getPublicVitrinePage(grace.vitrine.username)).badgeBrandself).toBe(false)
    expect((await getPublicVitrinePage(termine.vitrine.username)).badgeBrandself).toBe(true)
  })

  it('should expose no subscription field in the public resource of a payer vitrine', async () => {
    const { getPublicVitrinePage } = await vitrinesService()
    const { toVitrinePublicResource } = await import('../../server/resources/vitrine')
    const actif = await creerAbonne('actif')

    const page = await getPublicVitrinePage(actif.vitrine.username)
    const dto = JSON.stringify(toVitrinePublicResource(page.vitrine, page.badgeBrandself))

    for (const interdit of ['expireLe', 'expire_le', 'abonnement', '"plan"', 'graceJusquau', 'premiereActivation']) expect(dto).not.toContain(interdit)
    expect(dto).toContain('"badgeBrandself":false')
  })

  it('should hide the badge through a real payment too : free -> paid by webhook', async () => {
    const { getPublicVitrinePage } = await vitrinesService()
    const pro = await creerAbonne('gratuit')
    expect((await getPublicVitrinePage(pro.vitrine.username)).badgeBrandself).toBe(true)

    await recevoir(corpsPour(await insererPaiement(pro.user.id)), { now: new Date() })

    expect((await getPublicVitrinePage(pro.vitrine.username)).badgeBrandself).toBe(false)
  })
})
