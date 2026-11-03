import { Temporal } from '@js-temporal/polyfill'
import type { LimitePlanDTO } from '../../shared/dto/abonnement'
import { ABONNEMENT_FUSEAU_REPLI } from '../../shared/plans'
import type { PlanId, RessourceQuota } from '../../shared/plans'
import { ForbiddenError } from '../exceptions/http'

// S10 (docs/specs/S10-abonnements.md §5.1) : règles PURES des plans. Aucune base, aucun réseau, aucune horloge
// implicite (l'instant est toujours injecté). Testées par tests/unit.

/** Une ligne d'une liste plafonnée par le plan (services, réalisations, témoignages). */
export interface LignePlafonnable {
  id: string
  actif: boolean
  createdAt: Date
}

export interface BornesMois {
  /** Inclus : minuit local du 1er jour du mois civil. */
  debut: Date
  /** Exclu : minuit local du 1er jour du mois suivant. */
  fin: Date
}

export interface DonneesErreurLimite {
  limite: number
  utilise: number
  plan: PlanId
}

/** Fuseau IANA valide, sinon le repli (un `users.fuseau` corrompu ne doit jamais faire échouer un quota). */
export function normaliserFuseau(fuseau: string): string {
  try {
    Temporal.Now.zonedDateTimeISO(fuseau)
    return fuseau
  } catch {
    return ABONNEMENT_FUSEAU_REPLI
  }
}

/** Mois civil local qui contient `now` : [minuit du 1er, minuit du 1er du mois suivant). */
export function bornesMoisLocal(now: Date, fuseau: string): BornesMois {
  const zone = normaliserFuseau(fuseau)
  const jour = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(zone).toPlainDate()
  const premier = jour.with({ day: 1 })
  return {
    debut: new Date(premier.toZonedDateTime(zone).epochMilliseconds),
    fin: new Date(premier.add({ months: 1 }).toZonedDateTime(zone).epochMilliseconds),
  }
}

/** Début (minuit local) du mois civil qui contient `now`. */
export function debutMoisLocal(now: Date, fuseau: string): Date {
  return bornesMoisLocal(now, fuseau).debut
}

/** Dernier jour payé (AAAA-MM-JJ) : l'échéance est exclusive, donc la milliseconde qui précède appartient au dernier jour. */
export function dernierJourInclusLocal(expireLe: Date, fuseau: string): string {
  return Temporal.Instant.fromEpochMilliseconds(expireLe.getTime())
    .toZonedDateTimeISO(normaliserFuseau(fuseau))
    .subtract({ milliseconds: 1 })
    .toPlainDate()
    .toString()
}

/** Échéance + `jours` jours CIVILS locaux (minuit local conservé, y compris au passage de l'heure d'été). */
export function ajouterJoursLocaux(instant: Date, jours: number, fuseau: string): Date {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(normaliserFuseau(fuseau))
  return new Date(zoned.add({ days: jours }).epochMilliseconds)
}

/** Du plus ancien au plus récent : `created_at` puis `id` (même ordre que le SQL de plan-visibilite.ts). */
function comparerAnciennete(a: LignePlafonnable, b: LignePlafonnable): number {
  const ecart = a.createdAt.getTime() - b.createdAt.getTime()
  if (ecart !== 0) return ecart
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** Ids des éléments ACTIFS que le plan laisse visibles : les `limite` plus anciens. `null` = illimité. */
export function idsVisiblesParPlan(lignes: readonly LignePlafonnable[], limite: number | null): Set<string> {
  const actifs = lignes.filter((ligne) => ligne.actif)
  if (limite === null) return new Set(actifs.map((ligne) => ligne.id))
  return new Set([...actifs].sort(comparerAnciennete).slice(0, Math.max(0, limite)).map((ligne) => ligne.id))
}

/** Ids des éléments ACTIFS masqués par le plan (au-delà des `limite` plus anciens). */
export function idsMasquesParPlan(lignes: readonly LignePlafonnable[], limite: number | null): Set<string> {
  const visibles = idsVisiblesParPlan(lignes, limite)
  return new Set(lignes.filter((ligne) => ligne.actif && !visibles.has(ligne.id)).map((ligne) => ligne.id))
}

/** Éléments visibles publiquement (actifs ET dans le plafond), dans l'ORDRE D'ENTRÉE (l'ordre d'affichage est inchangé). */
export function appliquerPlafondPublic<T extends LignePlafonnable>(items: readonly T[], limite: number | null): T[] {
  const visibles = idsVisiblesParPlan(items, limite)
  return items.filter((item) => visibles.has(item.id))
}

/** Usage au regard de la limite, pour les compteurs du studio. */
export function construireLimitePlan(utilise: number, limite: number | null): LimitePlanDTO {
  return { limite, utilise, atteinte: limite !== null && utilise >= limite }
}

/** 403 LIMITE_PLAN_ATTEINTE : le texte de déblocage vient de LIMITE_MESSAGES (shared), interpolé côté interface. */
export function construireErreurLimite(ressource: RessourceQuota, donnees: DonneesErreurLimite): ForbiddenError {
  return new ForbiddenError('LIMITE_PLAN_ATTEINTE', {
    ressource,
    limite: donnees.limite,
    utilise: donnees.utilise,
    plan: donnees.plan,
  })
}
