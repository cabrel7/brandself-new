// S11 : service de statistiques de la vitrine.
// Règle : aucune logique métier dans une route ; cette couche est appelée par les routes et les jobs.
import { and, count, countDistinct, eq, gte, lt, sql } from 'drizzle-orm'
import {
  reservations,
  statistiquesJour,
  statistiquesJourPages,
  statistiquesJourSources,
  vitrines,
  vues,
} from '../../shared/db/schema'
import { NotFoundError, ForbiddenError } from '../exceptions/http'
import { db } from '../utils/db'
import { enforceLimit } from './limiteur'
import {
  AGGREGATION_FENETRE_JOURS,
  STATISTIQUES_PAGES_MAX,
  VUES_RETENTION_JOURS,
  STATISTIQUES_RETENTION_JOURS,
} from '../../shared/statistiques'
import { env } from '../../shared/env'
import type { PERIODES_STATISTIQUES } from '../../shared/statistiques'
import {
  classifierAppareil,
  classifierSource,
  empreinteVisite,
  estEmpreinteValide,
  estRobot,
  normaliserPage,
  paysDepuisEntetes,
  periodesAutorisees,
} from './statistiques-regles'
import { getPlanEffectif } from './plans'
import { PLANS } from '../config/plans'
import { Temporal } from '@js-temporal/polyfill'
import { randomUUID } from 'node:crypto'
import { VUE_PUBLIC_LIMIT, VUE_LIMITE_CLE_PREFIXE } from '../../shared/limites'

export interface VueInput {
  username: string
  chemin: string
  origine: string | null
  ip: string
  userAgent: string | null
  headers: Record<string, string | string[] | undefined>
  now: Date
}

export interface JourAgrégat {
  jour: string
  visites: number
  visiteursUniques: number
}

export interface PageAgrégat {
  type: string
  identifiant: string
  libelle: string
  visites: number
}

export interface SourceAgrégat {
  source: string
  libelle: string
  visites: number
}

export interface StatistiquesComplet {
  periode: number
  joursMax: number
  totaux: { visites: number; visiteursUniques: number; clics: number; reservations: number }
  parJour: JourAgrégat[]
  pages: PageAgrégat[] | null
  sources: SourceAgrégat[] | null
}

export interface Totaux7J {
  visites: number
  clics: number
  reservations: number
}

const LIBELLES_PAGES: Record<string, string> = {
  accueil: 'Accueil',
  service: 'Service',
  realisation: 'Réalisation',
  agenda: 'Agenda',
  contact: 'Contact',
  reservation: 'Réservation',
  autre: 'Autre page',
}

const LIBELLES_SOURCES: Record<string, string> = {
  direct: 'Accès direct',
  interne: 'Depuis votre vitrine',
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  yahoo: 'Yahoo',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  autre: 'Autre source',
}

/** Date civile `YYYY-MM-DD` d'une chaîne ISO ou d'un instant (ISO UTC : les bornes de comparaison sont UTC). */
function dateIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10)
}

/**
 * Livre l'empreinte d'une vue : valide la vitrine publiée, filtre les robots, calcule l'empreinte
 * (jamais l'IP en clair) et écrit la ligne brute.
 * Retourne `undefined` quand la vue est ignorée (robot).
 * Lève `NotFoundError` quand la vitrine est inconnue ou non publiée.
 */
export async function enregistrerVue(input: VueInput): Promise<void> {
  const { chemin, origine, ip, userAgent, headers, now } = input

  // 1. Vitrine cible publiée (404 sinon, aucune ligne écrite).
  const [vitrine] = await db
    .select({
      id: vitrines.id,
      fuseau: vitrines.fuseau,
      publieeLe: vitrines.publieeLe,
    })
    .from(vitrines)
    .where(and(eq(vitrines.username, input.username), sql`${vitrines.publieeLe} IS NOT NULL`))
    .limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')

  // 2. Robots : filtre avant toute écriture. UA absent → robot.
  if (estRobot(userAgent)) return

  // 3. Limiteur par IP (fail-open : une erreur Redis laisse passer, la navigation n'est jamais bloquée).
  await enforceLimit(`${VUE_LIMITE_CLE_PREFIXE}${ip}`, VUE_PUBLIC_LIMIT.limit, VUE_PUBLIC_LIMIT.windowS)

  // 4. Normalisation de la page (jamais de chemin brut en base).
  const { type, identifiant } = normaliserPage(chemin)

  // 5. Métadonnées de la requête.
  const appareil = classifierAppareil(userAgent)
  const pays = paysDepuisEntetes(headers)
  const source = classifierSource(origine, chemin, env.NUXT_PUBLIC_SITE_URL)

  // 6. Jour civil dans le fuseau de la vitrine (empreinte + agrégation).
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(vitrine.fuseau ?? 'Africa/Douala')
  const jourIso = local.toPlainDate().toString()

  const empreinte = empreinteVisite(ip, vitrine.id, jourIso)
  if (!estEmpreinteValide(empreinte)) throw new Error('EMPREINTE_INVALIDE')

  await db.insert(vues).values({
    id: randomUUID(),
    vitrineId: vitrine.id,
    jour: jourIso,
    empreinte,
    pageType: type,
    pageIdentifiant: identifiant,
    source,
    appareil,
    pays,
    createdAt: now,
  })
}

/**
 * Lecture des statistiques pour le studio. Hybride :
 * - jours `jour >= aujourd'hui_local - 1` : lu en direct sur `vues` (agrégat GROUP BY) ;
 * - jours plus anciens : lecture des agrégats (`statistiques_jour`, `..._pages`, `..._sources`) ;
 * - clics : toujours dans `statistiques_jour` (incrémentés en temps réel par `recordLienClic`).
 * Période refusée hors plan → 403 `STATISTIQUES_PERIODE_INTERDITE`.
 */
export async function getStatistiques(
  userId: string,
  periode: number,
  now: Date = new Date(),
): Promise<StatistiquesComplet> {
  const [vitrine] = await db
    .select({ id: vitrines.id, fuseau: vitrines.fuseau })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')

  const effectif = await getPlanEffectif(userId, now)
  const config = PLANS[effectif.plan]
  const joursMaxPlan = config.statistiquesJours
  const details = config.statistiquesDetails

  const autorisees = periodesAutorisees(joursMaxPlan)
  if (!autorisees.includes(periode as (typeof PERIODES_STATISTIQUES)[number])) {
    throw new ForbiddenError('STATISTIQUES_PERIODE_INTERDITE', { periode, joursMax: joursMaxPlan })
  }

  const fuseau = vitrine.fuseau ?? 'Africa/Douala'
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(fuseau).startOfDay()
  const finDate = today.toPlainDate().toString()
  const debutDate = today.subtract({ days: periode - 1 }).startOfDay().toPlainDate().toString()
  const jourHier = today.subtract({ days: 1 }).toPlainDate().toString()

  const debutEpoch = Temporal.ZonedDateTime.from(`${debutDate}T00:00:00[${fuseau}]`).epochMilliseconds
  const finEpoch = Temporal.ZonedDateTime.from(`${finDate}T00:00:00[${fuseau}]`).epochMilliseconds + 86_400_000

  // Clics sur toute la fenêtre (toujours dans l'agrégat).
  const lignesClics = await db
    .select({ jour: statistiquesJour.jour, clics: statistiquesJour.clics })
    .from(statistiquesJour)
    .where(and(
      eq(statistiquesJour.vitrineId, vitrine.id),
      gte(statistiquesJour.jour, debutDate),
      lt(statistiquesJour.jour, finDate),
    ))
  const clicsParJour = new Map<string, number>()
  for (const ligne of lignesClics) clicsParJour.set(dateIso(ligne.jour), Number(ligne.clics))

  // Réservations : tous statuts, créées dans la fenêtre.
  const [nbReservations] = await db
    .select({ total: count() })
    .from(reservations)
    .where(and(
      eq(reservations.vitrineId, vitrine.id),
      gte(reservations.createdAt, new Date(debutEpoch)),
      lt(reservations.createdAt, new Date(finEpoch)),
    ))

  // Visites : hybride. Jours récents en direct sur `vues`, jours anciens via agrégats.
  const visitesParJour = new Map<string, { visites: number; visiteursUniques: number }>()
  const pagesParJour = new Map<string, Map<string, { type: string; identifiant: string; visites: number }>>()
  const sourcesParJour = new Map<string, Map<string, { source: string; visites: number }>>()

  const joursDirects = new Set<string>()
  {
    let j = today
    for (let i = 0; i < periode; i++) {
      const iso = j.toPlainDate().toString()
      if (iso >= jourHier) joursDirects.add(iso)
      j = j.subtract({ days: 1 })
    }
  }

  if (joursDirects.size > 0) {
    const liste = Array.from(joursDirects)
    const minIso = liste.reduce((a, b) => (a < b ? a : b))
    const maxIso = liste.reduce((a, b) => (a > b ? a : b))
    const maxSuivant = new Date(Date.parse(`${maxIso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const rows = await db
      .select({
        jour: vues.jour,
        pageType: vues.pageType,
        pageIdentifiant: vues.pageIdentifiant,
        source: vues.source,
        empreinte: vues.empreinte,
      })
      .from(vues)
      .where(and(
        eq(vues.vitrineId, vitrine.id),
        gte(vues.jour, minIso),
        lt(vues.jour, maxSuivant),
      ))
    const empreintesParJour = new Map<string, Set<string>>()
    for (const row of rows) {
      const jour = String(row.jour).slice(0, 10)
      if (!joursDirects.has(jour)) continue

      const v = visitesParJour.get(jour) ?? { visites: 0, visiteursUniques: 0 }
      v.visites += 1
      visitesParJour.set(jour, v)

      const empreintes = empreintesParJour.get(jour) ?? new Set<string>()
      if (!empreintes.has(row.empreinte)) {
        empreintes.add(row.empreinte)
        empreintesParJour.set(jour, empreintes)
        v.visiteursUniques += 1
        visitesParJour.set(jour, v)
      }

      const pagesJ = pagesParJour.get(jour) ?? new Map<string, { type: string; identifiant: string; visites: number }>()
      const clePage = `${row.pageType}|${row.pageIdentifiant}`
      const p = pagesJ.get(clePage) ?? { type: row.pageType, identifiant: row.pageIdentifiant, visites: 0 }
      p.visites += 1
      pagesJ.set(clePage, p)
      pagesParJour.set(jour, pagesJ)

      const sourcesJ = sourcesParJour.get(jour) ?? new Map<string, { source: string; visites: number }>()
      const s = sourcesJ.get(row.source) ?? { source: row.source, visites: 0 }
      s.visites += 1
      sourcesJ.set(row.source, s)
      sourcesParJour.set(jour, sourcesJ)
    }
  }

  // Agrégats pour les jours plus anciens.
  const visitesAgrégat = new Map<string, { visites: number; visiteursUniques: number }>()
  {
    const lignes = await db
      .select({ jour: statistiquesJour.jour, visites: statistiquesJour.visites, visiteursUniques: statistiquesJour.visiteursUniques })
      .from(statistiquesJour)
      .where(and(
        eq(statistiquesJour.vitrineId, vitrine.id),
        gte(statistiquesJour.jour, debutDate),
        lt(statistiquesJour.jour, finDate),
      ))
    for (const ligne of lignes) {
      const jour = dateIso(ligne.jour)
      if (joursDirects.has(jour)) continue
      visitesAgrégat.set(jour, { visites: Number(ligne.visites), visiteursUniques: Number(ligne.visiteursUniques) })
    }
  }
  {
    const lignes = await db
      .select({
        jour: statistiquesJourPages.jour,
        pageType: statistiquesJourPages.pageType,
        pageIdentifiant: statistiquesJourPages.pageIdentifiant,
        visites: statistiquesJourPages.visites,
      })
      .from(statistiquesJourPages)
      .where(and(
        eq(statistiquesJourPages.vitrineId, vitrine.id),
        gte(statistiquesJourPages.jour, debutDate),
        lt(statistiquesJourPages.jour, finDate),
      ))
    for (const ligne of lignes) {
      const jour = dateIso(ligne.jour)
      if (joursDirects.has(jour)) continue
      const pagesJ = pagesParJour.get(jour) ?? new Map<string, { type: string; identifiant: string; visites: number }>()
      const clePage = `${ligne.pageType}|${ligne.pageIdentifiant}`
      const p = pagesJ.get(clePage) ?? { type: ligne.pageType, identifiant: ligne.pageIdentifiant, visites: 0 }
      p.visites += Number(ligne.visites)
      pagesJ.set(clePage, p)
      pagesParJour.set(jour, pagesJ)
    }
  }
  {
    const lignes = await db
      .select({ jour: statistiquesJourSources.jour, source: statistiquesJourSources.source, visites: statistiquesJourSources.visites })
      .from(statistiquesJourSources)
      .where(and(
        eq(statistiquesJourSources.vitrineId, vitrine.id),
        gte(statistiquesJourSources.jour, debutDate),
        lt(statistiquesJourSources.jour, finDate),
      ))
    for (const ligne of lignes) {
      const jour = dateIso(ligne.jour)
      if (joursDirects.has(jour)) continue
      const sourcesJ = sourcesParJour.get(jour) ?? new Map<string, { source: string; visites: number }>()
      const s = sourcesJ.get(ligne.source) ?? { source: ligne.source, visites: 0 }
      s.visites += Number(ligne.visites)
      sourcesJ.set(ligne.source, s)
      sourcesParJour.set(jour, sourcesJ)
    }
  }

  // Assemblage par jour décroissant.
  const parJour: JourAgrégat[] = []
  let jourCourant = today
  for (let i = 0; i < periode; i++) {
    const jour = jourCourant.toPlainDate().toString()
    const v = visitesParJour.get(jour) ?? visitesAgrégat.get(jour) ?? { visites: 0, visiteursUniques: 0 }
    parJour.push({ jour, visites: v.visites, visiteursUniques: v.visiteursUniques })
    jourCourant = jourCourant.subtract({ days: 1 })
  }

  const totauxVisites = parJour.reduce((s, j) => s + j.visites, 0)
  const totauxVisiteurs = parJour.reduce((s, j) => s + j.visiteursUniques, 0)
  const totauxClics = Array.from(clicsParJour.values()).reduce((s, c) => s + c, 0)

  // Pages et sources : top, libellés côté serveur, seulement si détails du plan.
  let pages: PageAgrégat[] | null = null
  let sources: SourceAgrégat[] | null = null
  if (details) {
    const pagesAgrégat = new Map<string, PageAgrégat>()
    for (const pagesJ of pagesParJour.values()) {
      for (const p of pagesJ.values()) {
        const cle = `${p.type}|${p.identifiant}`
        const existant = pagesAgrégat.get(cle)
        if (existant) existant.visites += p.visites
        else pagesAgrégat.set(cle, { type: p.type, identifiant: p.identifiant, libelle: LIBELLES_PAGES[p.type] ?? 'Autre page', visites: p.visites })
      }
    }
    pages = Array.from(pagesAgrégat.values())
      .sort((a, b) => b.visites - a.visites || a.type.localeCompare(b.type) || a.identifiant.localeCompare(b.identifiant))
      .slice(0, STATISTIQUES_PAGES_MAX)

    const sourcesAgrégat = new Map<string, SourceAgrégat>()
    for (const sourcesJ of sourcesParJour.values()) {
      for (const s of sourcesJ.values()) {
        const existant = sourcesAgrégat.get(s.source)
        if (existant) existant.visites += s.visites
        else sourcesAgrégat.set(s.source, { source: s.source, libelle: LIBELLES_SOURCES[s.source] ?? 'Autre source', visites: s.visites })
      }
    }
    sources = Array.from(sourcesAgrégat.values())
      .sort((a, b) => b.visites - a.visites || a.source.localeCompare(b.source))
      .slice(0, STATISTIQUES_PAGES_MAX)
  }

  return {
    periode,
    joursMax: joursMaxPlan,
    totaux: { visites: totauxVisites, visiteursUniques: totauxVisiteurs, clics: totauxClics, reservations: Number(nbReservations?.total ?? 0) },
    parJour,
    pages,
    sources,
  }
}

/** Sous-ensemble pour l'accueil du studio (période 7, totaux seulement). */
export async function getTotaux7J(userId: string, now: Date = new Date()): Promise<Totaux7J> {
  const stats = await getStatistiques(userId, 7, now)
  return {
    visites: stats.totaux.visites,
    clics: stats.totaux.clics,
    reservations: stats.totaux.reservations,
  }
}

/**
 * Compteurs visites/clics pour le résumé hebdomadaire.
 * Période `[debut, fin)` (instants UTC) dans le fuseau de la vitrine.
 * - visites : somme de `statistiques_jour.visites` pour les jours agrégés + comptage live sur `vues`
 *   pour les jours `>= aujourd'hui - 1`.
 * - clics : somme de `statistiques_jour.clics` (incrémentés en temps réel, disponibles dès le premier clic).
 */
export async function getCompteursResume(
  vitrineId: string,
  fuseau: string,
  periode: { debut: Date; fin: Date },
): Promise<{ visites: number; clics: number }> {
  const maintenantLocal = Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(fuseau).startOfDay()
  const jourHier = maintenantLocal.subtract({ days: 1 }).toPlainDate().toString()

  const debutJour = Temporal.Instant.fromEpochMilliseconds(periode.debut.getTime()).toZonedDateTimeISO(fuseau).startOfDay()
  const finJour = Temporal.Instant.fromEpochMilliseconds(periode.fin.getTime()).toZonedDateTimeISO(fuseau).subtract({ milliseconds: 1 }).startOfDay()

  const debutDate = debutJour.toPlainDate().toString()
  const finDate = finJour.toPlainDate().toString()
  const finExclusive = new Date(Date.parse(`${finDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

  // Jours récents (>= aujourd'hui - 1) lus en direct sur `vues`.
  const joursDirects = new Set<string>()
  {
    let j = finJour
    while (Temporal.ZonedDateTime.compare(j, debutJour) >= 0) {
      const iso = j.toPlainDate().toString()
      if (iso >= jourHier) joursDirects.add(iso)
      j = j.subtract({ days: 1 })
    }
  }

  // Visites : jours anciens via agrégat, jours récents en direct.
  let visites = 0
  {
    const lignes = await db
      .select({ visites: statistiquesJour.visites, jour: statistiquesJour.jour })
      .from(statistiquesJour)
      .where(and(
        eq(statistiquesJour.vitrineId, vitrineId),
        gte(statistiquesJour.jour, debutDate),
        lt(statistiquesJour.jour, finExclusive),
      ))
    for (const ligne of lignes) {
      const jour = dateIso(ligne.jour)
      if (!joursDirects.has(jour)) visites += Number(ligne.visites)
    }
  }
  if (joursDirects.size > 0) {
    const liste = Array.from(joursDirects)
    const minIso = liste.reduce((a, b) => (a < b ? a : b))
    const maxIso = liste.reduce((a, b) => (a > b ? a : b))
    const maxSuivant = new Date(Date.parse(`${maxIso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const rows = await db
      .select({ jour: vues.jour })
      .from(vues)
      .where(and(
        eq(vues.vitrineId, vitrineId),
        gte(vues.jour, minIso),
        lt(vues.jour, maxSuivant),
      ))
    for (const row of rows) {
      const jour = String(row.jour).slice(0, 10)
      if (joursDirects.has(jour)) visites += 1
    }
  }

  // Clics : toujours agrégat (incrémenté en temps réel), toute la période.
  let clics = 0
  {
    const lignes = await db
      .select({ clics: statistiquesJour.clics, jour: statistiquesJour.jour })
      .from(statistiquesJour)
      .where(and(
        eq(statistiquesJour.vitrineId, vitrineId),
        gte(statistiquesJour.jour, debutDate),
        lt(statistiquesJour.jour, finExclusive),
      ))
    for (const ligne of lignes) {
      const jour = dateIso(ligne.jour)
      if (!joursDirects.has(jour)) clics += Number(ligne.clics)
    }
  }

  return { visites, clics }
}

/** Job d'agrégation : idempotent, écrit les 3 agrégats pour la fenêtre des 4 derniers jours UTC. */
export async function agregerStatistiques(now: Date = new Date()): Promise<void> {
  const aujourdHuiUTC = new Date(now.getTime())
  aujourdHuiUTC.setUTCHours(0, 0, 0, 0)
  const debutFenetre = new Date(aujourdHuiUTC.getTime() - (AGGREGATION_FENETRE_JOURS - 1) * 86_400_000)

  const lignes = await db
    .select({
      vitrineId: vues.vitrineId,
      jour: vues.jour,
      visites: count(),
      visiteursUniques: countDistinct(vues.empreinte),
    })
    .from(vues)
    .where(gte(vues.jour, dateIso(debutFenetre)))
    .groupBy(vues.vitrineId, vues.jour)

  for (const ligne of lignes) {
    const vitrineId = String(ligne.vitrineId)
    const jour = dateIso(ligne.jour)
    await db.insert(statistiquesJour).values({
      vitrineId,
      jour,
      visites: Number(ligne.visites),
      visiteursUniques: Number(ligne.visiteursUniques),
      clics: 0,
    }).onConflictDoUpdate({
      target: [statistiquesJour.vitrineId, statistiquesJour.jour],
      set: { visites: Number(ligne.visites), visiteursUniques: Number(ligne.visiteursUniques), updatedAt: now },
    })

    const lignesPages = await db
      .select({ pageType: vues.pageType, pageIdentifiant: vues.pageIdentifiant, visites: count() })
      .from(vues)
      .where(and(eq(vues.vitrineId, vitrineId), eq(vues.jour, jour)))
      .groupBy(vues.pageType, vues.pageIdentifiant)
    for (const p of lignesPages) {
      await db.insert(statistiquesJourPages).values({
        vitrineId,
        jour,
        pageType: String(p.pageType),
        pageIdentifiant: String(p.pageIdentifiant ?? ''),
        visites: Number(p.visites),
      }).onConflictDoUpdate({
        target: [statistiquesJourPages.vitrineId, statistiquesJourPages.jour, statistiquesJourPages.pageType, statistiquesJourPages.pageIdentifiant],
        set: { visites: Number(p.visites), updatedAt: now },
      })
    }

    const lignesSources = await db
      .select({ source: vues.source, visites: count() })
      .from(vues)
      .where(and(eq(vues.vitrineId, vitrineId), eq(vues.jour, jour)))
      .groupBy(vues.source)
    for (const s of lignesSources) {
      await db.insert(statistiquesJourSources).values({
        vitrineId,
        jour,
        source: String(s.source),
        visites: Number(s.visites),
      }).onConflictDoUpdate({
        target: [statistiquesJourSources.vitrineId, statistiquesJourSources.jour, statistiquesJourSources.source],
        set: { visites: Number(s.visites), updatedAt: now },
      })
    }
  }
}

/** Purge : lignes brutes > 90 j, agrégats > 180 j (bornes UTC, ramenées à la date civile de la colonne). */
export async function purgerStatistiques(now: Date = new Date()): Promise<void> {
  const limiteVues = dateIso(new Date(now.getTime() - VUES_RETENTION_JOURS * 86_400_000))
  const limiteAggregats = dateIso(new Date(now.getTime() - STATISTIQUES_RETENTION_JOURS * 86_400_000))

  await db.delete(vues).where(lt(vues.jour, limiteVues))
  await db.delete(statistiquesJour).where(lt(statistiquesJour.jour, limiteAggregats))
  await db.delete(statistiquesJourPages).where(lt(statistiquesJourPages.jour, limiteAggregats))
  await db.delete(statistiquesJourSources).where(lt(statistiquesJourSources.jour, limiteAggregats))
}
