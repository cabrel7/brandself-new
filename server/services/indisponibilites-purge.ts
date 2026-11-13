// Purge des indisponibilités échues. Une indisponibilité de plus de INDISPONIBILITE_RETENTION_JOURS jours ne sert
// plus (ni à la réservation, ni à l'historique du studio). Suppression BORNÉE (lots de INDISPONIBILITE_PURGE_LOT,
// au plus INDISPONIBILITE_PURGE_LOTS_MAX lots par passage), idempotente, ne renvoie qu'un nombre : aucune donnée
// personnelle (la raison saisie peut en contenir) dans les journaux. Une date future ou récente n'est jamais touchée.
import { inArray, lt } from 'drizzle-orm'
import {
  INDISPONIBILITE_PURGE_LOT,
  INDISPONIBILITE_PURGE_LOTS_MAX,
  INDISPONIBILITE_RETENTION_JOURS,
} from '../../shared/agenda'
import { indisponibilites } from '../../shared/db/schema'
import { db } from '../utils/db'
import { dateLimitePurge } from './agenda-regles'

export async function purgerIndisponibilites(now: Date = new Date()): Promise<number> {
  const limite = dateLimitePurge(now, INDISPONIBILITE_RETENTION_JOURS)
  let total = 0
  for (let lot = 0; lot < INDISPONIBILITE_PURGE_LOTS_MAX; lot += 1) {
    const supprimees = await db
      .delete(indisponibilites)
      .where(inArray(
        indisponibilites.id,
        db.select({ id: indisponibilites.id }).from(indisponibilites).where(lt(indisponibilites.date, limite)).limit(INDISPONIBILITE_PURGE_LOT),
      ))
      .returning({ id: indisponibilites.id })
    total += supprimees.length
    if (supprimees.length < INDISPONIBILITE_PURGE_LOT) break
  }
  return total
}
