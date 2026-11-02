import { and, count, eq, gte, lt, sql } from 'drizzle-orm'
import { generationsIa, users } from '../../shared/db/schema'
import type { QuotaIaDTO } from '../../shared/dto/ia'
import type { IaPlan } from '../../shared/ia'
import { PLANS } from '../config/plans'
import { db } from '../utils/db'

// S8 §4.9 : PlanService minimal. Le quota est LU, jamais appliqué en S8 (l'interface et le blocage
// arrivent en S10) : une génération normale est toujours créée, même au-delà de la limite.

/**
 * Plan d'un utilisateur. Il n'y a pas encore de table `abonnements` (S10) : tout le monde est au plan
 * gratuit. Quand elle existera, seul ce corps changera.
 */
export async function getPlanForUser(_userId: string): Promise<IaPlan> {
  return 'gratuit'
}

/**
 * Générations IA réellement produites (`terminee`, pas les replis) dans le mois civil du fuseau de
 * l'utilisateur, comparées à la limite du plan.
 */
export async function getIaQuota(userId: string, now: Date = new Date()): Promise<QuotaIaDTO> {
  const plan = await getPlanForUser(userId)
  const limite = PLANS[plan].generationsIaParMois

  const maintenant = now.toISOString()
  const debutDuMois = sql`(date_trunc('month', ${maintenant}::timestamptz AT TIME ZONE ${users.fuseau}) AT TIME ZONE ${users.fuseau})`
  const debutMoisSuivant = sql`((date_trunc('month', ${maintenant}::timestamptz AT TIME ZONE ${users.fuseau}) + interval '1 month') AT TIME ZONE ${users.fuseau})`
  const [ligne] = await db
    .select({ total: count() })
    .from(generationsIa)
    .innerJoin(users, eq(users.id, generationsIa.userId))
    .where(
      and(
        eq(generationsIa.userId, userId),
        eq(generationsIa.statut, 'terminee'),
        gte(generationsIa.createdAt, debutDuMois),
        lt(generationsIa.createdAt, debutMoisSuivant),
      ),
    )
  const utilisees = ligne?.total ?? 0

  return {
    plan,
    limite,
    utilisees,
    restantes: limite === null ? null : Math.max(0, limite - utilisees),
    depasse: limite !== null && utilisees >= limite,
  }
}
