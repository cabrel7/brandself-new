// A5 (D-A5-06, spec §6) : aperçu d'impact d'une limite de plan, en LECTURE SEULE. Services, réalisations et
// témoignages : comptes dont les éléments ACTIFS dépassent la limite candidate, et éléments qui seraient masqués
// (jamais supprimés). Réservations et IA : comptes dont l'usage du mois courant atteint déjà la limite.
// Approximation documentée (R7) : la période de grâce est comptée à une journée près.
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { IA_TYPES_QUOTA } from '../../../shared/ia'
import type { PlanId } from '../../../shared/plans'
import type { ImpactPlan, ValeursPlan } from '../../../shared/schemas/admin-versions'
import { vitrines } from '../../../shared/db/schema'
import { db } from '../../utils/db'
import { lireGraceJours } from '../plans'
import { sqlVitrinePublique } from '../visibilite'

type ExecuteurImpact = Pick<typeof db, 'execute'>

/** Tables comptées (liste fermée : le nom est inséré tel quel dans la requête, jamais une entrée utilisateur). */
const TABLES_MASQUAGE = { services: 'services', realisations: 'realisations', temoignages: 'temoignages' } as const
type RessourceMasquage = keyof typeof TABLES_MASQUAGE

const STATUTS_RESERVATION_COMPTES = ['en_attente', 'confirmee', 'terminee'] as const

/** Comptes du plan concerné : gratuits = sans abonnement ou grâce écoulée ; payants = abonnement ou grâce en cours. */
function sqlComptesDuPlan(plan: PlanId, graceJours: number): SQL {
  // R2 : durée de grâce = réglage `abonnement.grace_jours` (`lireGraceJours`), lue par l'appelant.
  const grace = sql`make_interval(days => ${graceJours}::int)`
  return plan === 'gratuit'
    ? sql`SELECT u.id, u.fuseau FROM users u LEFT JOIN abonnements a ON a.user_id = u.id WHERE a.user_id IS NULL OR a.expire_le + ${grace} <= now()`
    : sql`SELECT u.id, u.fuseau FROM users u JOIN abonnements a ON a.user_id = u.id WHERE a.expire_le + ${grace} > now()`
}

async function impactMasquage(
  executeur: ExecuteurImpact,
  plan: PlanId,
  ressource: RessourceMasquage,
  limite: number | null,
): Promise<{ comptes: number, elementsMasques: number }> {
  if (limite === null) return { comptes: 0, elementsMasques: 0 }
  const graceJours = await lireGraceJours()
  const table = sql.raw(TABLES_MASQUAGE[ressource])
  const resultat = await executeur.execute<{ comptes: string, elements_masques: string }>(sql`
    WITH comptes_plan AS (${sqlComptesDuPlan(plan, graceJours)}),
    vitrines_visibles AS (
      SELECT vitrines.id, vitrines.user_id FROM vitrines
      JOIN comptes_plan c ON c.id = vitrines.user_id
      WHERE ${sqlVitrinePublique(vitrines)}
    ),
    comptage AS (
      SELECT vv.user_id, count(e.id) FILTER (WHERE e.actif) AS actifs
      FROM vitrines_visibles vv LEFT JOIN ${table} e ON e.vitrine_id = vv.id
      GROUP BY vv.id, vv.user_id
    )
    SELECT count(DISTINCT user_id) FILTER (WHERE actifs > ${limite}) AS comptes,
           coalesce(sum(greatest(actifs - ${limite}, 0)), 0) AS elements_masques
    FROM comptage`)
  const ligne = resultat.rows[0]
  return { comptes: Number(ligne?.comptes ?? 0), elementsMasques: Number(ligne?.elements_masques ?? 0) }
}

async function impactReservations(executeur: ExecuteurImpact, plan: PlanId, limite: number | null): Promise<{ comptes: number }> {
  if (limite === null) return { comptes: 0 }
  const graceJours = await lireGraceJours()
  const resultat = await executeur.execute<{ comptes: string }>(sql`
    WITH comptes_plan AS (${sqlComptesDuPlan(plan, graceJours)}),
    usage AS (
      SELECT v.id, v.user_id, count(r.id) AS total
      FROM vitrines v
      JOIN comptes_plan c ON c.id = v.user_id
      LEFT JOIN reservations r ON r.vitrine_id = v.id
        AND r.statut IN (${sql.join(STATUTS_RESERVATION_COMPTES.map((s) => sql`${s}`), sql`, `)})
        AND r.created_at >= date_trunc('month', now() AT TIME ZONE v.fuseau) AT TIME ZONE v.fuseau
        AND r.created_at < (date_trunc('month', now() AT TIME ZONE v.fuseau) + interval '1 month') AT TIME ZONE v.fuseau
      GROUP BY v.id, v.user_id
    )
    SELECT count(DISTINCT user_id) FILTER (WHERE total >= ${limite}) AS comptes FROM usage`)
  return { comptes: Number(resultat.rows[0]?.comptes ?? 0) }
}

async function impactIa(executeur: ExecuteurImpact, plan: PlanId, limite: number | null): Promise<{ comptes: number }> {
  if (limite === null) return { comptes: 0 }
  const graceJours = await lireGraceJours()
  const resultat = await executeur.execute<{ comptes: string }>(sql`
    WITH comptes_plan AS (${sqlComptesDuPlan(plan, graceJours)}),
    usage AS (
      SELECT c.id AS user_id, count(g.id) AS total
      FROM comptes_plan c
      LEFT JOIN generations_ia g ON g.user_id = c.id
        AND g.statut = 'terminee'
        AND g.type IN (${sql.join(IA_TYPES_QUOTA.map((t) => sql`${t}`), sql`, `)})
        AND g.created_at >= date_trunc('month', now() AT TIME ZONE c.fuseau) AT TIME ZONE c.fuseau
        AND g.created_at < (date_trunc('month', now() AT TIME ZONE c.fuseau) + interval '1 month') AT TIME ZONE c.fuseau
      GROUP BY c.id
    )
    SELECT count(*) FILTER (WHERE total >= ${limite}) AS comptes FROM usage`)
  return { comptes: Number(resultat.rows[0]?.comptes ?? 0) }
}

/**
 * Impact des valeurs candidates d'un plan. Un changement sur le plan payant n'est aperçu que si sa limite devient
 * finie (une limite `null` n'a aucun impact). Aucune écriture.
 */
export async function apercuImpactPlan(
  plan: PlanId,
  valeurs: Pick<ValeursPlan, 'services' | 'realisations' | 'temoignages' | 'reservationsParMois' | 'generationsIaParMois'>,
  executeur: ExecuteurImpact = db,
): Promise<ImpactPlan> {
  const [services, realisations, temoignages, reservationsMois, generationsIaMois] = await Promise.all([
    impactMasquage(executeur, plan, 'services', valeurs.services),
    impactMasquage(executeur, plan, 'realisations', valeurs.realisations),
    impactMasquage(executeur, plan, 'temoignages', valeurs.temoignages),
    impactReservations(executeur, plan, valeurs.reservationsParMois),
    impactIa(executeur, plan, valeurs.generationsIaParMois),
  ])
  return { services, realisations, temoignages, reservationsMois, generationsIaMois }
}

/** Deux impacts sont-ils identiques ? (comparaison exacte des compteurs). */
export function memeImpact(a: ImpactPlan, b: ImpactPlan): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Au moins un compte est concerné (sinon il n'y a rien à acquitter). */
export function impactNonNul(impact: ImpactPlan): boolean {
  return [impact.services, impact.realisations, impact.temoignages, impact.reservationsMois, impact.generationsIaMois].some((r) => r.comptes > 0)
}
