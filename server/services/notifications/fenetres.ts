import type { Temporal } from '@js-temporal/polyfill'
import { RESUME_PERIODE_JOURS } from '../../../shared/notifications'

// S9 (docs/specs/S9-notifications.md §4.3) : fenêtres horaires LOCALES. Fonctions PURES : l'instant
// est injecté sous forme de `ZonedDateTime` déjà placé dans le fuseau du destinataire. Temporal gère
// les changements d'heure : les bornes sont des minuits LOCAUX (périodes de 167, 168 ou 169 h,
// journées de 23, 24 ou 25 h), jamais des multiples de 24 h.

const MINUTES_PAR_HEURE = 60
const SEMAINE_ISO_CHIFFRES = 2

export interface Periode {
  debut: Temporal.Instant
  fin: Temporal.Instant
  label: string
}

/**
 * Vrai si l'heure MURALE locale est dans `[heure, heure + rattrapageH)`. On lit l'horloge du mur
 * (heure et minute), pas le temps écoulé depuis minuit : le 28 mars à Paris, 07:00 n'est que la
 * 6e heure écoulée.
 */
export function dansFenetre(local: Temporal.ZonedDateTime, heure: number, rattrapageH: number): boolean {
  const minutesMurales = local.hour * MINUTES_PAR_HEURE + local.minute
  return minutesMurales >= heure * MINUTES_PAR_HEURE && minutesMurales < (heure + rattrapageH) * MINUTES_PAR_HEURE
}

/** Minuit local du jour donné (`startOfDay` gère les fuseaux dont le minuit n'existe pas). */
function minuitLocal(local: Temporal.ZonedDateTime): Temporal.ZonedDateTime {
  return local.startOfDay()
}

/** Début (minuit local) de la semaine ISO qui contient `local`, c'est-à-dire du lundi. */
function lundiLocal(local: Temporal.ZonedDateTime): Temporal.ZonedDateTime {
  return minuitLocal(local).subtract({ days: local.dayOfWeek - 1 }).startOfDay()
}

export function debutSemaineIso(local: Temporal.ZonedDateTime): Temporal.Instant {
  return lundiLocal(local).toInstant()
}

/** Journée locale `[minuit, minuit suivant)` étiquetée `AAAA-MM-JJ` (date civile du fuseau). */
export function journeeLocale(local: Temporal.ZonedDateTime): Periode {
  const debut = minuitLocal(local)
  const fin = debut.add({ days: 1 }).startOfDay()
  return { debut: debut.toInstant(), fin: fin.toInstant(), label: debut.toPlainDate().toString() }
}

/**
 * Période du résumé : les `RESUME_PERIODE_JOURS` jours locaux qui précèdent le lundi local de `local`.
 * `fin` = minuit du lundi, `debut` = `fin` moins N jours CALENDAIRES (pas N x 24 h). L'étiquette est
 * la semaine ISO de la période (`GGGG-Www`, année ISO), commune à tous les ticks de la journée.
 */
export function periodeResume(local: Temporal.ZonedDateTime): Periode {
  const fin = lundiLocal(local)
  const debut = fin.subtract({ days: RESUME_PERIODE_JOURS }).startOfDay()
  const semaine = String(debut.weekOfYear ?? 0).padStart(SEMAINE_ISO_CHIFFRES, '0')
  return { debut: debut.toInstant(), fin: fin.toInstant(), label: `${debut.yearOfWeek}-W${semaine}` }
}
