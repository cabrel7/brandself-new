import { and, eq, inArray } from 'drizzle-orm'
import { medias, vitrines } from '../../shared/db/schema'
import { NotFoundError, UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { deleteMediaIfUnreferenced } from './medias'

// Accès à la vitrine de l'utilisateur et aux médias, communs à toutes les listes (services,
// réalisations, témoignages). Extraits de services.ts par la factorisation S4 (décision #58).

/** Tout ce qui sait faire un `select` : la base elle-même ou une transaction. */
export type Executor = Pick<typeof db, 'select'>
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function requireVitrineId(userId: string): Promise<string> {
  const [vitrine] = await db.select({ id: vitrines.id }).from(vitrines).where(eq(vitrines.userId, userId)).limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine.id
}

/** Verrou sur la ligne vitrine : sérialise vedette, slug, ordre et galerie des écritures concurrentes. */
export async function lockVitrineId(tx: Transaction, userId: string): Promise<string> {
  const [vitrine] = await tx
    .select({ id: vitrines.id })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .for('update')
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine.id
}

/** Tous les médias appartiennent à l'utilisateur (une seule requête), sinon MEDIA_INVALIDE. Liste vide : rien. */
export async function requireOwnedMedias(executor: Executor, userId: string, ids: readonly string[]): Promise<void> {
  const uniques = [...new Set(ids)]
  if (uniques.length === 0) return
  const owned = await executor
    .select({ id: medias.id })
    .from(medias)
    .where(and(inArray(medias.id, uniques), eq(medias.userId, userId)))
  if (owned.length !== uniques.length) throw new UnprocessableError('MEDIA_INVALIDE')
}

/**
 * Supprime les médias qui ne sont plus référencés, APRÈS le commit. Ne rejette jamais : un orphelin
 * de fichier sera nettoyé plus tard, l'échec ne doit pas faire échouer l'écriture déjà validée.
 */
export async function cleanupMedias(userId: string, ids: readonly string[], contexte: string): Promise<void> {
  for (const id of ids) {
    try {
      await deleteMediaIfUnreferenced(userId, id)
    } catch (error) {
      console.error({ [contexte]: 'image non supprimée', nom: error instanceof Error ? error.name : typeof error })
    }
  }
}
