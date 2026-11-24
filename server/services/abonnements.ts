import { and, desc, eq, inArray } from 'drizzle-orm'
import { abonnements, paiements, users } from '../../shared/db/schema'
import type { Paiement } from '../../shared/db/schema'
import type { OffreDTO, QuotaDTO } from '../../shared/dto/abonnement'
import type { EssaiPublicDTO } from '../../shared/essai'
import { PAIEMENT_STATUTS_OUVERTS } from '../../shared/paiements'
import { PLAN_IDS } from '../../shared/plans'
import type { PlanId, RessourceQuota } from '../../shared/plans'
import { LIMITE_CHAMP_PAR_RESSOURCE } from '../config/plans'
import type { ConfigPlan } from '../config/plans'
import { db } from '../utils/db'
import { assurerInstantane, instantaneCache, lirePlanConfig } from './configuration/lecture'
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
  /** E1 : `finLe` de l'essai tant qu'il est EN COURS (origine `essai` et état actif) ; `null` sinon (payé, offert, échu). */
  essai: { finLe: Date } | null
}

/** Origine d'un abonnement d'essai gratuit (`abonnements.origine`). */
const ORIGINE_ESSAI = 'essai'

/** Limite d'une ressource dans la configuration d'un plan (`null` = illimité). */
export function limiteConfig(config: ConfigPlan, ressource: RessourceQuota): number | null {
  return config[LIMITE_CHAMP_PAR_RESSOURCE[ressource]]
}

/** Vue du Compte : plan effectif (calculé, PlanService), paiement en cours, quotas et offre de paiement. */
export async function getAbonnementView(userId: string, now: Date): Promise<AbonnementView> {
  await assurerInstantane()
  const [etat, quotas, [utilisateur], [enCours], [ligneAbonnement]] = await Promise.all([
    getPlanEffectif(userId, now),
    getQuotas(userId, now),
    db.select({ devise: users.devise }).from(users).where(eq(users.id, userId)),
    db
      .select()
      .from(paiements)
      .where(and(eq(paiements.userId, userId), inArray(paiements.statut, [...PAIEMENT_STATUTS_OUVERTS])))
      .orderBy(desc(paiements.createdAt))
      .limit(1),
    db.select({ origine: abonnements.origine }).from(abonnements).where(eq(abonnements.userId, userId)).limit(1),
  ])
  const finEssai = ligneAbonnement?.origine === ORIGINE_ESSAI && etat.etat === 'actif' ? etat.expireLe : null
  return {
    plan: etat.plan,
    etat,
    paiementEnCours: enCours ?? null,
    quotas,
    offre: construireOffre(utilisateur?.devise),
    essai: finEssai === null ? null : { finLe: finEssai },
  }
}

/** Plans et offre publics (`/tarifs`) : configuration seule, aucune base. */
export function getTarifs(devise: string | undefined): { plans: { id: PlanId, config: ConfigPlan }[], offre: OffreDTO, essai: EssaiPublicDTO } {
  // A5 : plans, prix, frais et moyens viennent des versions ACTIVES (instantané de 5 s au plus, rafraîchi en tâche de
  // fond : la route publique reste synchrone), repli sur le code.
  // E1 : la mention de l'essai suit la version `essai` active (même instantané, même cache de 5 s).
  const { actif, dureeJours } = instantaneCache().essai
  return {
    plans: PLAN_IDS.map((id) => ({ id, config: lirePlanConfig(id) })),
    offre: construireOffre(devise),
    essai: { actif, dureeJours },
  }
}
