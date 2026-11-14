// A1 (D-A1-05) : lecture AUTORITAIRE d'une session d'administration. On relit la base (session, compte) au lieu de
// croire le jeton : la durée absolue de 8 h, le rôle, la suspension et le drapeau `admin` sont vérifiés à chaque appel.
import { eq } from 'drizzle-orm'
import { ADMIN_SESSION_DUREE_S, SUPERADMIN } from '../../../shared/admin'
import { sessions, users } from '../../../shared/db/schema'
import { db } from '../../utils/db'

const MS_PAR_SECONDE = 1_000
const NOM_REPLI = 'Administrateur'

export interface SessionAdmin {
  adminId: string
  nom: string
  email: string
  sessionId: string
  sessionCreeeLe: Date
  /** Fin réelle de la session : la plus proche entre `expires_at` et `created_at + 8 h`. */
  expireLe: Date
}

/** Dernier instant valide d'une session d'administration (durée absolue, jamais prolongée). */
export function finAbsolue(creeeLe: Date): Date {
  return new Date(creeeLe.getTime() + ADMIN_SESSION_DUREE_S * MS_PAR_SECONDE)
}

/**
 * Session d'administration valide, sinon `null` (cause jamais distinguée par l'appelant : 404 uniforme).
 * Dépassement des 8 h : la session est SUPPRIMÉE (le cookie, de 30 jours, ne vaut plus rien).
 */
export async function lireSessionAdmin(sessionId: string, maintenant: Date = new Date()): Promise<SessionAdmin | null> {
  const [ligne] = await db
    .select({
      sessionId: sessions.id,
      creeeLe: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      admin: sessions.admin,
      incarnePar: sessions.impersonatedBy,
      adminId: users.id,
      role: users.role,
      suspendu: users.banned,
      suspensionFin: users.banExpires,
      nom: users.nom,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1)
  if (!ligne) return null

  // Une session ORDINAIRE n'est jamais touchée ici (404 sans effet de bord) : seule une session d'administration
  // au-delà de ses 8 h est supprimée.
  if (ligne.admin !== true) return null
  const fin = finAbsolue(ligne.creeeLe)
  if (fin.getTime() <= maintenant.getTime()) {
    await supprimerSessionAdmin(ligne.sessionId)
    return null
  }
  if (ligne.incarnePar !== null) return null
  if (ligne.role !== SUPERADMIN) return null
  if (ligne.suspendu === true && (ligne.suspensionFin === null || ligne.suspensionFin.getTime() > maintenant.getTime())) return null
  if (ligne.expiresAt.getTime() <= maintenant.getTime()) return null

  return {
    adminId: ligne.adminId,
    nom: ligne.nom.trim() || ligne.name.trim() || NOM_REPLI,
    email: ligne.email,
    sessionId: ligne.sessionId,
    sessionCreeeLe: ligne.creeeLe,
    expireLe: ligne.expiresAt.getTime() < fin.getTime() ? ligne.expiresAt : fin,
  }
}

/** Supprime la session (déconnexion, dépassement de durée). Idempotent. */
export async function supprimerSessionAdmin(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}
