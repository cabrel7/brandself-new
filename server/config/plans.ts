import type { IaPlan } from '../../shared/ia'

// S8 §4.9 : configuration minimale des plans. CLAUDE.md §4 règle 11 : aucune limite de plan écrite dans un
// composant ou une route, tout passe par `PlanService` et ce fichier. Il sera complété en S10 (abonnements),
// avec la même forme d'objet. `null` = illimité.

export interface ConfigPlan {
  generationsIaParMois: number | null
}

export const PLANS: Record<IaPlan, ConfigPlan> = {
  gratuit: { generationsIaParMois: 3 },
  payant: { generationsIaParMois: null },
}
