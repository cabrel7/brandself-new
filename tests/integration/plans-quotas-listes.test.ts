import { describe, expect, it } from 'vitest'
import { PLANS } from '../../server/config/plans'
import { LIMITE_MESSAGES } from '../../shared/plans'
import { schemaTemoignageCreate } from '../../shared/schemas/temoignage'
import { ajouterRealisations, ajouterServices, ajouterTemoignages, compter, creerAbonne, viderServices } from './support/abonnements'
import { rejet } from './support/erreurs'
import { insertService } from './support/fabriques'
import { creer as creerRealisation } from './support/realisations'
import { creer as creerService } from './support/services'

// S10 §6 CA78 à CA81 et #124/#125 : quotas de création des services, réalisations et témoignages, contre la VRAIE base.
// Les comptages portent sur TOUTES les lignes (visibles ou masquées) : masquer pour recréer ne contourne pas la limite.
// Les services de création lisent l'horloge réelle : les abonnements de départ sont datés par rapport à `Date.now()`.

const LIMITE = PLANS.gratuit.services ?? 0

const temoignagesService = () => import('../../server/services/temoignages')

async function creerTemoignage(userId: string, n: number) {
  const { createTemoignage } = await temoignagesService()
  return createTemoignage(userId, schemaTemoignageCreate.parse({ slug: `temoignage-${n}-${Math.random().toString(36).slice(2, 8)}`, auteur: `Auteur ${n}`, texte: 'Très bien.' }))
}

const RESSOURCES = [
  {
    nom: 'services' as const,
    limite: PLANS.gratuit.services ?? 0,
    remplir: async (vitrineId: string, n: number) => { await viderServices(vitrineId); await ajouterServices(vitrineId, n) },
    creer: (userId: string, n: number) => creerService(userId, { titre: `Nouveau service ${n}` }),
    table: 'services' as const,
  },
  {
    nom: 'realisations' as const,
    limite: PLANS.gratuit.realisations ?? 0,
    remplir: async (vitrineId: string, n: number) => { await ajouterRealisations(vitrineId, n) },
    creer: (userId: string, n: number) => creerRealisation(userId, { titre: `Nouvelle réalisation ${n}` }),
    table: 'realisations' as const,
  },
  {
    nom: 'temoignages' as const,
    limite: PLANS.gratuit.temoignages ?? 0,
    remplir: async (vitrineId: string, n: number) => { await ajouterTemoignages(vitrineId, n) },
    creer: (userId: string, n: number) => creerTemoignage(userId, n),
    table: 'temoignages' as const,
  },
]

describe.each(RESSOURCES)('quota de création : $nom', (ressource) => {
  it('should refuse the creation at the limit of the free plan with 403 LIMITE_PLAN_ATTEINTE, the unlock data, and create no row (CA78, CA80)', async () => {
    const pro = await creerAbonne('gratuit')
    await ressource.remplir(pro.vitrine.id, ressource.limite)

    const erreur = await rejet(ressource.creer(pro.user.id, 1))

    expect(erreur).toMatchObject({ code: 'LIMITE_PLAN_ATTEINTE', status: 403, estDomainError: true })
    expect(erreur.data).toMatchObject({ ressource: ressource.nom, limite: ressource.limite, utilise: ressource.limite, plan: 'gratuit' })
    expect(LIMITE_MESSAGES[ressource.nom].texte).toContain('{limite}')
    expect(await compter(ressource.table, pro.vitrine.id)).toBe(ressource.limite)
  })

  it('should accept the last creation allowed by the free plan (limit - 1 existing)', async () => {
    const pro = await creerAbonne('gratuit')
    await ressource.remplir(pro.vitrine.id, ressource.limite - 1)

    await ressource.creer(pro.user.id, 1)

    expect(await compter(ressource.table, pro.vitrine.id)).toBe(ressource.limite)
  })

  it('should let exactly one of two simultaneous creations through at limit - 1 : one success, one 403, `limite` rows (CA79, CA80)', async () => {
    const pro = await creerAbonne('gratuit')
    await ressource.remplir(pro.vitrine.id, ressource.limite - 1)

    const resultats = await Promise.allSettled([ressource.creer(pro.user.id, 1), ressource.creer(pro.user.id, 2)])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refus = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(refus?.reason).toMatchObject({ code: 'LIMITE_PLAN_ATTEINTE', status: 403 })
    expect(await compter(ressource.table, pro.vitrine.id)).toBe(ressource.limite)
  })

  it('should never exceed the limit under eight simultaneous creations', async () => {
    const pro = await creerAbonne('gratuit')
    await ressource.remplir(pro.vitrine.id, 0)

    const resultats = await Promise.allSettled(Array.from({ length: 8 }, (_v, i) => ressource.creer(pro.user.id, i)))

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(ressource.limite)
    expect(await compter(ressource.table, pro.vitrine.id)).toBe(ressource.limite)
  })

  it('should not let a payer-plan user hit any limit : 10 existing, the 11th is created (CA81)', async () => {
    const pro = await creerAbonne('actif')
    await ressource.remplir(pro.vitrine.id, 10)

    await ressource.creer(pro.user.id, 1)

    expect(await compter(ressource.table, pro.vitrine.id)).toBe(11)
  })

  it('should keep the payer rights during the grace period : the 4th element is created (CA64)', async () => {
    const pro = await creerAbonne('grace')
    await ressource.remplir(pro.vitrine.id, ressource.limite)

    await ressource.creer(pro.user.id, 1)

    expect(await compter(ressource.table, pro.vitrine.id)).toBe(ressource.limite + 1)
  })

  it('should apply the free limit again once the grace period is over, WITHOUT deleting anything (CA65)', async () => {
    const pro = await creerAbonne('termine')
    await ressource.remplir(pro.vitrine.id, ressource.limite + 2)

    const erreur = await rejet(ressource.creer(pro.user.id, 1))

    expect(erreur.code).toBe('LIMITE_PLAN_ATTEINTE')
    expect(erreur.data).toMatchObject({ limite: ressource.limite, utilise: ressource.limite + 2, plan: 'gratuit' })
    expect(await compter(ressource.table, pro.vitrine.id)).toBe(ressource.limite + 2)
  })

  it('should isolate users : the limit of one vitrine never blocks another one', async () => {
    const plein = await creerAbonne('gratuit')
    const autre = await creerAbonne('gratuit')
    await ressource.remplir(plein.vitrine.id, ressource.limite)
    await ressource.remplir(autre.vitrine.id, 0)

    await ressource.creer(autre.user.id, 1)

    expect(await compter(ressource.table, autre.vitrine.id)).toBe(1)
  })
})

describe('quota des services : lignes masquées et désactivées comptent', () => {
  it('should count a service switched off by its owner : disabling does not free a place (CA78 "dont 1 masqué")', async () => {
    const pro = await creerAbonne('gratuit')
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, LIMITE - 1)
    await insertService(pro.vitrine.id, { titre: 'Désactivé', actif: false })

    const erreur = await rejet(creerService(pro.user.id, { titre: 'Encore un' }))

    expect(erreur.data).toMatchObject({ ressource: 'services', limite: LIMITE, utilise: LIMITE })
  })

  it('should keep the 403 payload free of internal data (no user id, no vitrine id, no SQL)', async () => {
    const pro = await creerAbonne('gratuit')
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, LIMITE)

    const erreur = await rejet(creerService(pro.user.id, { titre: 'Encore un' }))

    const texte = JSON.stringify({ data: erreur.data, message: erreur.message })
    for (const interdit of [pro.user.id, pro.vitrine.id, 'select ', 'insert ']) expect(texte).not.toContain(interdit)
  })
})
