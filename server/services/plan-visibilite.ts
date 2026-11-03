import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { realisations, services, temoignages } from '../../shared/db/schema'
import type { LimitePlanDTO } from '../../shared/dto/abonnement'
import type { EtatAbonnement, PlanId, RessourceMasquable } from '../../shared/plans'
import { PLANS } from '../config/plans'
import type { ConfigPlan } from '../config/plans'
import { db } from '../utils/db'
import type { Compteurs } from './listes-regles'
import { getPlanEffectif, limiteDe } from './plans'
import { construireLimitePlan, idsMasquesParPlan } from './plans-regles'
import type { LignePlafonnable } from './plans-regles'
import type { Executor } from './vitrine-acces'

// S10 (docs/specs/S10-abonnements.md §1 #127, #128) : module UNIQUE du masquage par plan. Au-delà de la limite du
// plan effectif, seuls les N plus anciens éléments ACTIFS (`created_at, id` croissants) restent visibles ; rien
// n'est jamais supprimé ni modifié, la réapparition au renouvellement est automatique (calcul à la lecture).
// Toutes les lectures publiques de services, réalisations et témoignages passent par `sqlIdsVisibles`.

/** Tables dont l'excédent est masqué (RESSOURCES_MASQUABLES) : elles partagent id, vitrine_id, actif, created_at. */
export type TableMasquable = typeof services | typeof realisations | typeof temoignages

export interface PlanPublic {
  plan: PlanId
  etat: EtatAbonnement
  limites: ConfigPlan
  /** Badge « Créé avec Brandself » (vrai au plan gratuit uniquement). Le statut d'abonnement n'est jamais exposé. */
  badge: boolean
}

/**
 * Plan effectif du propriétaire d'une vitrine publiée (UNE requête). Les droits payants sont conservés pendant la
 * grâce (#121) : pas de badge, pas de masquage.
 */
export async function getPlanPublic(
  proprietaire: { userId: string },
  now: Date = new Date(),
  executor: Executor = db,
): Promise<PlanPublic> {
  const effectif = await getPlanEffectif(proprietaire.userId, now, executor)
  const limites = PLANS[effectif.plan]
  return { plan: effectif.plan, etat: effectif.etat, limites, badge: limites.badge }
}

/**
 * Condition SQL « cet élément est visible publiquement » : parmi les éléments actifs de la vitrine, les `limite`
 * plus anciens. `limite: null` (illimité) : condition toujours vraie. À combiner avec `actif` (déjà garanti par la
 * sous-requête, répété par les appelants pour la lisibilité des index).
 */
export function sqlIdsVisibles(table: TableMasquable, vitrineId: string, limite: number | null): SQL {
  if (limite === null) return sql`true`
  return sql`${table.id} in (
    select classes.id from (
      select ${table.id} as id, row_number() over (order by ${table.createdAt}, ${table.id}) as rn
      from ${table}
      where ${table.vitrineId} = ${vitrineId} and ${table.actif}
    ) as classes
    where classes.rn <= ${limite}
  )`
}

/** Compteurs d'une liste du studio, plus l'usage au regard de la limite du plan (`limitePlan`). */
export interface CompteursAvecPlan extends Compteurs {
  limitePlan: LimitePlanDTO
}

export interface VuePlanStudio {
  limitePlan: LimitePlanDTO
  /** Éléments actifs que le plan masque sur la vitrine (étiquette « Masqué sur la vitrine »). */
  masques: ReadonlySet<string>
}

/** Limite du plan effectif pour une liste du studio ; `null` = illimité. */
export async function getLimiteStudio(
  userId: string,
  ressource: RessourceMasquable,
  now: Date = new Date(),
  executor: Executor = db,
): Promise<number | null> {
  return limiteDe((await getPlanEffectif(userId, now, executor)).plan, ressource)
}

/** Vue du studio sur une liste COMPLÈTE de la vitrine : usage au regard de la limite, et éléments masqués. */
export function vuePlanStudio(lignes: readonly LignePlafonnable[], limite: number | null): VuePlanStudio {
  return { limitePlan: construireLimitePlan(lignes.length, limite), masques: idsMasquesParPlan(lignes, limite) }
}

/** Ajoute `masqueParPlan` à une ligne sans la muter. */
export function marquerMasque<T extends { id: string }>(ligne: T, masques: ReadonlySet<string>): T & { masqueParPlan: boolean } {
  return { ...ligne, masqueParPlan: masques.has(ligne.id) }
}
