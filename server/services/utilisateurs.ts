import { and, desc, eq, gt } from 'drizzle-orm'
import { ACCOUNT_DELETION_PHRASE, FRESH_SESSION_MAX_AGE_S } from '../../shared/compte'
import { sessions, users, vitrines } from '../../shared/db/schema'
import type { MoiUpdateInput } from '../../shared/schemas/moi'
import { BadRequestError, ForbiddenError, NotFoundError, UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { deleteAllUserMediaFiles } from './medias'

export type UserRow = typeof users.$inferSelect

export interface MeView {
  user: UserRow
  vitrine: { username: string, publieeLe: Date | null } | null
}

export interface DeviceView {
  id: string
  userAgent: string | null
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  actuel: boolean
}

const MS_PER_SECOND = 1000

export async function getMe(userId: string): Promise<MeView> {
  const [row] = await db
    .select({ user: users, username: vitrines.username, publieeLe: vitrines.publieeLe })
    .from(users)
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) {
    // Impossible avec une session valide (les sessions sont supprimées en cascade avec le compte).
    throw new Error('Utilisateur introuvable.')
  }
  return {
    user: row.user,
    vitrine: row.username === null ? null : { username: row.username, publieeLe: row.publieeLe },
  }
}

/** Met à jour les préférences ; un changement de fuseau suit sur la vitrine (même transaction). */
export async function updateMe(userId: string, patch: MoiUpdateInput): Promise<MeView> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
    if (updated.length === 0) throw new Error('Utilisateur introuvable.')
    if (patch.fuseau !== undefined) {
      await tx.update(vitrines).set({ fuseau: patch.fuseau, updatedAt: new Date() }).where(eq(vitrines.userId, userId))
    }
  })
  return getMe(userId)
}

/** Sessions actives de l'utilisateur, la plus récemment utilisée d'abord. Jamais de jeton. */
export async function listDevices(userId: string, currentSessionId: string): Promise<DeviceView[]> {
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.updatedAt))
  return rows.map((row) => ({ ...row, actuel: row.id === currentSessionId }))
}

/** Révoque une autre session de l'utilisateur (suppression en base : le cache cookie est désactivé). */
export async function revokeDevice(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
  if (sessionId === currentSessionId) throw new UnprocessableError('SESSION_ACTUELLE')
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id })
  if (deleted.length === 0) throw new NotFoundError('APPAREIL_INTROUVABLE')
}

export interface AccountDeletionInput {
  confirmation: string
  sessionCreatedAt: Date
}

/**
 * Supprime le compte et, en cascade, sessions, comptes liés, vitrine et médias (lignes).
 * Les fichiers sont effacés APRÈS le commit ; un échec est journalisé et laisse des orphelins.
 */
export async function deleteAccount(userId: string, input: AccountDeletionInput): Promise<void> {
  if (input.confirmation.trim() !== ACCOUNT_DELETION_PHRASE) throw new BadRequestError('CONFIRMATION_INVALIDE')
  const ageMs = Date.now() - input.sessionCreatedAt.getTime()
  // Négation volontaire : une date illisible (NaN) doit refuser, jamais autoriser.
  if (!(ageMs <= FRESH_SESSION_MAX_AGE_S * MS_PER_SECOND)) throw new ForbiddenError('SESSION_TROP_ANCIENNE')

  await db.delete(users).where(eq(users.id, userId))

  await deleteAllUserMediaFiles(userId).catch((error: unknown) => {
    console.error({ utilisateurs: 'fichiers non supprimés', nom: error instanceof Error ? error.name : typeof error })
  })
}
