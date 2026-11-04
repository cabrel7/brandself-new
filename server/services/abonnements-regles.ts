import { Temporal } from '@js-temporal/polyfill'
import { ABONNEMENT_FUSEAU_REPLI } from '../../shared/plans'

// S10 (docs/specs/S10-abonnements.md §1 #119, #120) : règles pures de prolongation (l'état actif / grâce / gratuit
// est calculé par `resoudrePlanEffectif`, server/services/plans.ts). Aucune base, aucune horloge
// implicite : `now` est toujours passé. `expire_le` est EXCLUSIF et aligné sur un minuit local.

/** Fuseau IANA valide, sinon le repli (`Africa/Douala`) : un fuseau corrompu ne doit jamais bloquer un paiement. */
export function fuseauEffectif(fuseau: string): string {
  try {
    Temporal.Now.zonedDateTimeISO(fuseau)
    return fuseau
  } catch {
    return ABONNEMENT_FUSEAU_REPLI
  }
}

function enZone(instant: Date, fuseau: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(fuseauEffectif(fuseau))
}

function enDate(zone: Temporal.ZonedDateTime): Date {
  return new Date(zone.epochMilliseconds)
}

/**
 * Premier minuit local À PARTIR de `instant` : l'instant lui-même s'il est déjà un minuit local, sinon le minuit
 * suivant. Les transitions d'heure d'été sont gérées par Temporal (le minuit n'est pas toujours 24 h plus tard).
 */
export function minuitLocalSuivant(instant: Date, fuseau: string): Date {
  const zone = enZone(instant, fuseau)
  if (zone.equals(zone.startOfDay())) return enDate(zone)
  return enDate(zone.add({ days: 1 }).startOfDay())
}

/** Base d'une prolongation : l'échéance en cours si elle est future, sinon `now` (la grâce n'est pas facturée). */
export function choisirBase(now: Date, expireLe: Date | null): Date {
  return expireLe !== null && expireLe.getTime() > now.getTime() ? expireLe : now
}

/**
 * Nouvelle échéance : `base` + `mois` mois civils (31 janvier + 1 mois = 28 février), arrondie au minuit local
 * suivant (sauf si déjà minuit).
 */
export function calculerNouvelleEcheance(base: Date, mois: number, fuseau: string): Date {
  const decalee = enZone(base, fuseau).add({ months: mois }, { overflow: 'constrain' })
  return minuitLocalSuivant(enDate(decalee), fuseau)
}
