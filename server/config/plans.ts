import type { Devise } from '../../shared/compte'
import type { PeriodeMois, PlanId, RessourceQuota } from '../../shared/plans'

// S8 §4.9, complété en S10 (docs/specs/S10-abonnements.md §3.3, §11). CLAUDE.md §4 règle 11 : aucune limite de
// plan écrite dans un composant ou une route, tout passe par `PlanService` et ce fichier. `null` = illimité.
// Ce fichier est serveur : `app/` ne l'importe jamais (les limites et prix arrivent par les DTO).

export interface ConfigPlan {
  services: number | null
  realisations: number | null
  temoignages: number | null
  reservationsParMois: number | null
  generationsIaParMois: number | null
  /** Badge « Créé avec Brandself » sur la vitrine publique. */
  badge: boolean
  /** Jours d'historique des statistiques (application en S11). */
  statistiquesJours: number
}

export const PLANS: Record<PlanId, ConfigPlan> = {
  gratuit: {
    services: 3,
    realisations: 3,
    temoignages: 3,
    reservationsParMois: 10,
    generationsIaParMois: 3,
    badge: true,
    statistiquesJours: 7,
  },
  payant: {
    services: null,
    realisations: null,
    temoignages: null,
    reservationsParMois: null,
    generationsIaParMois: null,
    badge: false,
    statistiquesJours: 90,
  },
}

/** Champ de `ConfigPlan` qui porte la limite de chaque ressource (une seule table de correspondance). */
export const LIMITE_CHAMP_PAR_RESSOURCE: Record<RessourceQuota, keyof Pick<ConfigPlan,
  'services' | 'realisations' | 'temoignages' | 'reservationsParMois' | 'generationsIaParMois'>> = {
  services: 'services',
  realisations: 'realisations',
  temoignages: 'temoignages',
  reservations_mois: 'reservationsParMois',
  generations_ia_mois: 'generationsIaParMois',
}

/** Plan vendu (la ligne `abonnements.plan` n'en porte jamais d'autre en S10). */
export const PLAN_PAYANT_ID = 'payant' satisfies PlanId
/** Plan de repli, sans abonnement ou après la grâce. */
export const PLAN_GRATUIT_ID = 'gratuit' satisfies PlanId

/**
 * Validation commerciale de la grille de prix. `a_valider` : grille PROVISOIRE, le démarrage échoue en
 * production (`assertConfigPaiements`). Passer à `valide` seulement après décision (spec §13 question 1).
 */
export const PRIX_STATUTS = ['a_valider', 'valide'] as const
export type PrixStatut = (typeof PRIX_STATUTS)[number]
export const PRIX_STATUT: PrixStatut = 'a_valider'

export type GrillePrix = Record<Devise, Record<PeriodeMois, number>>

/**
 * Prix TTC du plan payant, en entiers de l'unité mineure de la devise (XAF : le franc ; EUR et USD : le
 * centime). Grille PROVISOIRE. EUR et USD sont préparés pour la carte : ils ne sont ni affichés ni proposés
 * tant qu'aucun moyen de paiement actif ne les accepte (#105).
 */
export const PRIX_PLANS: Record<typeof PLAN_PAYANT_ID, GrillePrix> = {
  payant: {
    XAF: { 1: 5_000, 3: 13_500, 12: 48_000 },
    EUR: { 1: 800, 3: 2_200, 12: 7_700 },
    USD: { 1: 900, 3: 2_500, 12: 8_600 },
  },
}
