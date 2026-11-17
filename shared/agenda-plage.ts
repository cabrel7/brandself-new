import { JOUR_MS } from './temps'

/**
 * Nombre de jours d'une plage de dates locales `AAAA-MM-JJ`, bornes incluses (1 = un seul jour).
 * Négatif ou nul si `fin` précède `debut` : l'appelant refuse alors la plage. Calcul en UTC pur (jours entiers,
 * sans heure d'été) ; les dates sont supposées déjà valides (`schemaDateLocale`).
 */
export function nombreJoursPlage(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / JOUR_MS) + 1
}
