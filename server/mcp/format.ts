// S16 : mise en forme des sorties destinées à l'assistant (heures dans le fuseau de la vitrine, liens absolus,
// lecture des arguments). Aucune logique métier.

import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import { env } from '../../shared/env'
import { ValidationError } from '../exceptions/http'

/**
 * Instant exprimé en heure LOCALE de la vitrine, avec son décalage (ISO 8601), à la seconde : le 4 novembre à
 * 09:00 UTC pour `Africa/Douala` donne `2026-11-04T10:00:00+01:00`. L'assistant n'a jamais à convertir un fuseau.
 */
export function isoDansFuseau(date: Date, fuseau: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(fuseau)
    .toString({ timeZoneName: 'never', smallestUnit: 'second' })
}

/** Lien absolu vers une page de l'application (l'assistant ne connaît pas l'adresse du site). */
export function lienAbsolu(chemin: string): string {
  return `${env.NUXT_PUBLIC_SITE_URL}${chemin}`
}

/**
 * Valide les arguments d'un outil (défauts appliqués). Le SDK les a déjà validés avec le même schéma ; cette seconde
 * lecture protège les appelants directs et garantit les valeurs par défaut. Échec : ValidationError (message français).
 */
export function lireArguments<S extends z.ZodType>(schema: S, args: unknown): z.output<S> {
  const resultat = schema.safeParse(args)
  if (!resultat.success) throw new ValidationError(z.flattenError(resultat.error).fieldErrors as Record<string, string[] | undefined>)
  return resultat.data
}
