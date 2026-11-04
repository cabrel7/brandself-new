import { and, desc, eq, inArray } from 'drizzle-orm'
import { paiements, users } from '../../shared/db/schema'
import type { Paiement } from '../../shared/db/schema'
import type { OffreDTO, QuotaDTO } from '../../shared/dto/abonnement'
import { PAIEMENT_STATUTS_OUVERTS } from '../../shared/paiements'
import { PLAN_IDS } from '../../shared/plans'
import type { PlanId, RessourceQuota } from '../../shared/plans'
import { LIMITE_CHAMP_PAR_RESSOURCE, PLANS } from '../config/plans'
import type { ConfigPlan } from '../config/plans'
import { db } from '../utils/db'
import { construireOffre } from './paiements/offre'
import { getPlanEffectif, getQuotas } from './plans'
import type { PlanEffectif } from './plans'

// S10 (docs/specs/S10-abonnements.md §5.2) : service d'abonnement. Les gros morceaux vivent dans
// server/services/paiements/ ; ce module les expose sous les noms prévus par la spec et assemble la vue du Compte.

export { initierPaiement, getOwnPaiement, suivrePaiement } from './paiements/initiation'
export type { InitiationDeps } from './paiements/initiation'
export { appliquerEvenement, prolonger } from './paiements/application'
export type { ResultatApplication, ResultatProlongation } from './paiements/application'
export { verifierPaiementsDus } from './paiements/rapprochement'
export type { RapprochementDeps, ResultatVerification } from './paiements/rapprochement'

export interface AbonnementView {
  /** Plan dont les droits s'appliquent (`payant` aussi pendant la grâce). */
  plan: PlanId
  etat: PlanEffectif
  paiementEnCours: Paiement | null
  quotas: QuotaDTO[]
  offre: OffreDTO
}

/** Limite d'une ressource dans la configuration d'un plan (`null` = illimité). */
export function limiteConfig(config: ConfigPlan, ressource: RessourceQuota): number | null {
  return config[LIMITE_CHAMP_PAR_RESSOURCE[ressource]]
}

/** Vue du Compte : plan effectif (calculé, PlanService), paiement en cours, quotas et offre de paiement. */
export async function getAbonnementView(userId: string, now: Date): Promise<AbonnementView> {
  const [etat, quotas, [utilisateur], [enCours]] = await Promise.all([
    getPlanEffectif(userId, now),
    getQuotas(userId, now),
    db.select({ devise: users.devise }).from(users).where(eq(users.id, userId)),
    db
      .select()
      .from(paiements)
      .where(and(eq(paiements.userId, userId), inArray(paiements.statut, [...PAIEMENT_STATUTS_OUVERTS])))
      .orderBy(desc(paiements.createdAt))
      .limit(1),
  ])
  return {
    plan: etat.plan,
    etat,
    paiementEnCours: enCours ?? null,
    quotas,
    offre: construireOffre(utilisateur?.devise),
  }
}

/** Plans et offre publics (`/tarifs`) : configuration seule, aucune base. */
export function getTarifs(devise: string | undefined): { plans: { id: PlanId, config: ConfigPlan }[], offre: OffreDTO } {
  return {
    plans: PLAN_IDS.map((id) => ({ id, config: PLANS[id] })),
    offre: construireOffre(devise),
  }
}
