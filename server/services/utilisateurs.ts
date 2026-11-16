import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { SUPERADMIN } from '../../shared/admin'
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
  // Les préférences d'e-mails ont un nom d'API en camelCase et des propriétés Drizzle en snake_case :
  // sans ce mapping explicite, Drizzle ignorerait la clé et la préférence ne serait pas enregistrée.
  const { emailHebdo, emailRappelJour, ...reste } = patch
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({
        ...reste,
        ...(emailHebdo === undefined ? {} : { email_hebdo: emailHebdo }),
        ...(emailRappelJour === undefined ? {} : { email_rappel_jour: emailRappelJour }),
        updatedAt: new Date(),
      })
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

/** Transaction ouverte par l'appelant (studio : `db.transaction` ; administration : la transaction qui journalise). */
export type TransactionCompte = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Supprime le compte et, en cascade, sessions, comptes liés, vitrine et médias (lignes) DANS la transaction de
 * l'appelant. A1 : un compte d'administration (ou référencé par le journal, FK RESTRICT) ne se supprime pas :
 * 422 `COMPTE_ADMIN`. Lecture et suppression dans la MÊME transaction, ligne verrouillée : pas de promotion ni
 * d'écriture de journal entre la vérification et la suppression.
 */
export async function supprimerCompteDansTransaction(tx: TransactionCompte, userId: string): Promise<void> {
  const [compte] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).for('update').limit(1)
  if (compte?.role === SUPERADMIN) throw new UnprocessableError('COMPTE_ADMIN')
  const journal = await tx.execute(sql`SELECT 1 FROM journal_admin WHERE admin_id = ${userId} LIMIT 1`)
  if (journal.rows.length > 0) throw new UnprocessableError('COMPTE_ADMIN')
  await tx.delete(users).where(eq(users.id, userId))
}

/** Efface les fichiers d'images du compte. À appeler APRÈS le commit ; un échec est journalisé et laisse des orphelins. */
export async function supprimerFichiersDuCompte(userId: string): Promise<void> {
  await deleteAllUserMediaFiles(userId).catch((error: unknown) => {
    console.error({ utilisateurs: 'fichiers non supprimés', nom: error instanceof Error ? error.name : typeof error })
  })
}

/**
 * Suppression complète d'un compte : lignes en une transaction (cascade), puis fichiers après le commit.
 * Partagée par le studio (`deleteAccount`, avec sa phrase et sa fraîcheur de session) ; l'administration (A2,
 * D-A2-08) utilise les deux étapes séparément pour journaliser dans la même transaction.
 */
export async function supprimerCompteEtFichiers(userId: string): Promise<void> {
  await db.transaction((tx) => supprimerCompteDansTransaction(tx, userId))
  await supprimerFichiersDuCompte(userId)
}

/**
 * Suppression à la demande du titulaire (studio) : phrase de confirmation et session récente exigées, puis
 * `supprimerCompteEtFichiers`.
 */
export async function deleteAccount(userId: string, input: AccountDeletionInput): Promise<void> {
  if (input.confirmation.trim() !== ACCOUNT_DELETION_PHRASE) throw new BadRequestError('CONFIRMATION_INVALIDE')
  const ageMs = Date.now() - input.sessionCreatedAt.getTime()
  // Négation volontaire : une date illisible (NaN) doit refuser, jamais autoriser.
  if (!(ageMs <= FRESH_SESSION_MAX_AGE_S * MS_PER_SECOND)) throw new ForbiddenError('SESSION_TROP_ANCIENNE')
  await supprimerCompteEtFichiers(userId)
}
