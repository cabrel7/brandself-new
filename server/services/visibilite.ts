// A2 (D-A2-03) : UNIQUE définition SQL de « vitrine visible du public ». Jumeau de `estVitrinePublique`
// (shared/admin-visibilite.ts) : les deux doivent rester équivalents. Une vitrine est publique si elle est publiée
// (`publiee_le`), non bloquée par l'administration (`blocage_admin`) et si son titulaire n'est pas suspendu
// (`users.suspendu`). Toute lecture ou écriture visiteur passe par ce module : aucune autre ne lit `publiee_le`.
import { and, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { users, vitrines } from '../../shared/db/schema'
import { NotFoundError } from '../exceptions/http'
import type { db } from '../utils/db'
import { hasValidUsernameFormat, normalizeUsername } from '../utils/username'

/** Ligne complète d'une vitrine visible du public (aucune jointure). */
export type VitrinePublique = typeof vitrines.$inferSelect

/** Connexion ou transaction : `requireVitrinePublique` s'appelle aussi dans la transaction d'une écriture visiteur. */
export type ExecuteurVisibilite = Pick<typeof db, 'select'>

/**
 * Prédicat SQL : publiée, non bloquée, titulaire non suspendu. `v` permet de passer un alias de `vitrines`. Le
 * titulaire est lu par sous-requête (`NOT EXISTS`) : la condition s'applique telle quelle à une jointure, un
 * `UPDATE ... FROM` ou une liste, sans dépendre de la requête englobante.
 */
export function sqlVitrinePublique(v: typeof vitrines = vitrines): SQL {
  return sql`(${v.publieeLe} IS NOT NULL AND ${v.blocageAdmin} = false AND NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${v.userId} AND ${users.banned}))`
}

/**
 * Vitrine visible d'un username. Absente, non publiée, bloquée, titulaire suspendu ou username mal formé :
 * 404 `VITRINE_INTROUVABLE`, sans distinguer la cause (le visiteur ne voit jamais la raison, D-A2-10).
 */
export async function requireVitrinePublique(executeur: ExecuteurVisibilite, rawUsername: string): Promise<VitrinePublique> {
  const username = normalizeUsername(rawUsername)
  if (!hasValidUsernameFormat(username)) throw new NotFoundError('VITRINE_INTROUVABLE')
  const [vitrine] = await executeur
    .select()
    .from(vitrines)
    .where(and(eq(vitrines.username, username), sqlVitrinePublique()))
    .limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine
}
