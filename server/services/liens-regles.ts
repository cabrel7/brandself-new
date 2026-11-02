import { LIEN_CHAMPS_PAR_TYPE } from '../../shared/liens'
import type { LienType } from '../../shared/liens'

// Règles pures des liens (aucune base, aucun réseau) : testées par tests/unit/liens-regles.test.ts.

const MSG_CHAMP_HORS_TYPE = 'Ce champ n’appartient pas à ce type de lien.'
const ISO_MONDAY_SHIFT = 6
const DAYS_PER_WEEK = 7
const ISO_DATE_LENGTH = 10

export interface LienWeeklyClicks {
  clicsSemaine: number
  semaineDebut: string
}

/** Lundi ISO de la date de référence, calculé exclusivement avec les primitives UTC. */
export function getIsoWeekStartUtc(reference: Date): string {
  if (Number.isNaN(reference.getTime())) throw new RangeError('Date de référence invalide.')

  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()))
  const daysSinceMonday = (start.getUTCDay() + ISO_MONDAY_SHIFT) % DAYS_PER_WEEK
  start.setUTCDate(start.getUTCDate() - daysSinceMonday)
  return start.toISOString().slice(0, ISO_DATE_LENGTH)
}

/** Un compteur stocké pour une ancienne semaine n’est jamais exposé dans le studio. */
export function getCurrentWeekClicks(row: LienWeeklyClicks, reference: Date = new Date()): number {
  return row.semaineDebut === getIsoWeekStartUtc(reference) ? row.clicsSemaine : 0
}

/**
 * Champs du patch qui n'appartiennent pas au type du lien (cohérence type/champs, S6) :
 * le type est fixé à la création, on ne change jamais la forme d'un lien existant.
 * `libelle` et `actif` sont communs à tous les types.
 */
export function checkLienPatchCoherence(
  type: LienType,
  patch: Readonly<Record<string, unknown>>,
): Record<string, string[]> {
  const acceptes = LIEN_CHAMPS_PAR_TYPE[type]
  const erreurs: Record<string, string[]> = {}
  for (const champ of ['url', 'numero', 'adresse', 'plateforme', 'page'] as const) {
    if (champ in patch && !acceptes.includes(champ)) {
      erreurs[champ] = [MSG_CHAMP_HORS_TYPE]
    }
  }
  return erreurs
}
