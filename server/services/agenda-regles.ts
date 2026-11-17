import { Temporal } from '@js-temporal/polyfill'
import { nombreJoursPlage } from '../../shared/agenda-plage'

// Règles pures de l'agenda (aucune base, aucune horloge implicite).

/** Jour local courant dans le fuseau de la vitrine. */
export function aujourdhuiLocal(now: Date, fuseau: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(fuseau).toPlainDate()
}

/** Vrai si `dateIso` (jour local `AAAA-MM-JJ`) est strictement antérieure à « aujourd'hui » dans `fuseau`. Aujourd'hui est accepté. */
export function dateEstPassee(dateIso: string, now: Date, fuseau: string): boolean {
  return Temporal.PlainDate.compare(Temporal.PlainDate.from(dateIso), aujourdhuiLocal(now, fuseau)) < 0
}

/** Toutes les dates `AAAA-MM-JJ` de `debut` à `fin` incluses, dans l'ordre. Lève si la plage est inversée ou dépasse `maxJours`. */
export function etendrePlage(debut: string, fin: string, maxJours: number): string[] {
  const nombre = nombreJoursPlage(debut, fin)
  if (nombre < 1) throw new RangeError('La fin de la plage précède son début.')
  if (nombre > maxJours) throw new RangeError('La plage dépasse la durée maximale.')
  const premier = Temporal.PlainDate.from(debut)
  return Array.from({ length: nombre }, (_, index) => premier.add({ days: index }).toString())
}

/** Bornes UTC [00:00 local, 00:00 local du lendemain) d'un jour local : `debut` inclus, `fin` exclu. */
export function bornesJourLocal(dateIso: string, fuseau: string): { debut: Date, fin: Date } {
  const jour = Temporal.PlainDate.from(dateIso)
  return {
    debut: new Date(jour.toZonedDateTime(fuseau).toInstant().epochMilliseconds),
    fin: new Date(jour.add({ days: 1 }).toZonedDateTime(fuseau).toInstant().epochMilliseconds),
  }
}

/** Date limite de purge : tout ce qui est strictement avant est supprimable (UTC, marge d'un jour négligeable sur 90). */
export function dateLimitePurge(now: Date, retentionJours: number): string {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO('UTC')
    .toPlainDate()
    .subtract({ days: retentionJours })
    .toString()
}
