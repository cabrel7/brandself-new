// S12 (#150) : génération du sitemap des vitrines publiées, paginé par lots.
// Une URL par vitrine publiée + ses éléments visibles (services, réalisations) selon le plan effectif.
// Toutes les requêtes sont groupées (≤ 4 par lot) pour respecter le budget de performance.
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { abonnements, realisations, services, vitrines } from '../../shared/db/schema'
import { db } from '../utils/db'
import { resoudrePlanEffectif } from './plans'
import { PLANS } from '../config/plans'
import type { ConfigPlan } from '../config/plans'
import type { PlanId } from '../../shared/plans'
import type { SitemapUrlDTO } from '../../shared/dto/media'

export interface VitrineSitemap {
  id: string
  userId: string
  username: string
  modifieLe: Date
  plan: PlanId
  config: ConfigPlan
}

/** Vitrines publiées, triées par date de modification décroissante.
 * Les abonnements sont récupérés en une seule requête (pas une par vitrine). */
async function listerVitrinesPubliees(now: Date, limite: number): Promise<VitrineSitemap[]> {
  const lignes = await db
    .select({
      id: vitrines.id,
      userId: vitrines.userId,
      username: vitrines.username,
      modifieLe: vitrines.updatedAt,
    })
    .from(vitrines)
    .where(isNotNull(vitrines.publieeLe))
    .orderBy(desc(vitrines.updatedAt))
    .limit(limite)

  if (lignes.length === 0) return []

  // Tous les abonnements en une seule requête, indexés par userId.
  const userIds = [...new Set(lignes.map((l) => l.userId))]
  const abos = await db
    .select({ userId: abonnements.userId, plan: abonnements.plan, expireLe: abonnements.expireLe })
    .from(abonnements)
    .where(inArray(abonnements.userId, userIds))
  const abosParUser = new Map(abos.map((a) => [a.userId, a]))

  const resultats: VitrineSitemap[] = []
  for (const ligne of lignes) {
    const abo = abosParUser.get(ligne.userId)
    const effectif = abo
      ? resoudrePlanEffectif({ plan: abo.plan, expireLe: abo.expireLe }, now)
      : resoudrePlanEffectif(null, now)
    const config = PLANS[effectif.plan]
    resultats.push({
      id: ligne.id,
      userId: ligne.userId,
      username: ligne.username,
      modifieLe: ligne.modifieLe,
      plan: effectif.plan,
      config,
    })
  }
  return resultats
}

/** URLs de sitemap pour une vitrine : elle-même, ses listes et ses éléments visibles. */
function urlsVitrine(
  v: VitrineSitemap,
  servicesVisibles: { slug: string, updatedAt: Date }[],
  realisationsVisibles: { slug: string, updatedAt: Date }[],
): SitemapUrlDTO[] {
  const urls: SitemapUrlDTO[] = []
  const vitrineLastmod = v.modifieLe.toISOString()
  urls.push({ loc: `/${v.username}`, lastmod: vitrineLastmod })
  if (servicesVisibles.length > 0) {
    urls.push({ loc: `/${v.username}/services`, lastmod: vitrineLastmod })
    for (const s of servicesVisibles) {
      const lastmod = new Date(Math.max(s.updatedAt.getTime(), v.modifieLe.getTime())).toISOString()
      urls.push({ loc: `/${v.username}/services/${s.slug}`, lastmod })
    }
  }
  if (realisationsVisibles.length > 0) {
    urls.push({ loc: `/${v.username}/realisations`, lastmod: vitrineLastmod })
    for (const r of realisationsVisibles) {
      const lastmod = new Date(Math.max(r.updatedAt.getTime(), v.modifieLe.getTime())).toISOString()
      urls.push({ loc: `/${v.username}/realisations/${r.slug}`, lastmod })
    }
  }
  return urls
}

/** Sitemap des vitrines publiées. `now` injectable pour les tests. */
export async function listerUrlsSitemap(now: Date = new Date()): Promise<SitemapUrlDTO[]> {
  const vitrinesSitemap = await listerVitrinesPubliees(now, 5000)
  if (vitrinesSitemap.length === 0) return []
  const urls: SitemapUrlDTO[] = []

  // Tous les services et réalisations actifs des vitrines du lot en 2 requêtes groupées.
  const vitrineIds = vitrinesSitemap.map((v) => v.id)
  const tousServices = await db
    .select({ slug: services.slug, updatedAt: services.updatedAt, vitrineId: services.vitrineId })
    .from(services)
    .where(and(
      inArray(services.vitrineId, vitrineIds),
      eq(services.actif, true),
    ))

  const tousRealisations = await db
    .select({ slug: realisations.slug, updatedAt: realisations.updatedAt, vitrineId: realisations.vitrineId })
    .from(realisations)
    .where(and(
      inArray(realisations.vitrineId, vitrineIds),
      eq(realisations.actif, true),
    ))

  // Index par vitrineId.
  const servicesParVitrine = new Map<string, typeof tousServices>()
  const realisationsParVitrine = new Map<string, typeof tousRealisations>()
  for (const s of tousServices) {
    const liste = servicesParVitrine.get(s.vitrineId) ?? []
    liste.push(s)
    servicesParVitrine.set(s.vitrineId, liste)
  }
  for (const r of tousRealisations) {
    const liste = realisationsParVitrine.get(r.vitrineId) ?? []
    liste.push(r)
    realisationsParVitrine.set(r.vitrineId, liste)
  }

  for (const v of vitrinesSitemap) {
    const servicesVitrine = servicesParVitrine.get(v.id) ?? []
    const realisationsVitrine = realisationsParVitrine.get(v.id) ?? []

    // Appliquer la limite du plan (row_number par vitrine) en mémoire.
    const limiteServices = v.config.services ?? null
    const servicesFiltres = limiteServices === null
      ? servicesVitrine
      : servicesVitrine
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.slug.localeCompare(b.slug))
          .slice(0, limiteServices)

    const limiteRealisations = v.config.realisations ?? null
    const realisationsFiltres = limiteRealisations === null
      ? realisationsVitrine
      : realisationsVitrine
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.slug.localeCompare(b.slug))
          .slice(0, limiteRealisations)

    urls.push(...urlsVitrine(v, servicesFiltres, realisationsFiltres))
  }

  return urls
}
