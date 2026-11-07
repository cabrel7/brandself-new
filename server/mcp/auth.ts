// S16 : authentification et autorisation du serveur MCP via @better-auth/mcp.
// OAuth 2.1 avec PKCE, portées séparées, jetons courts et renouvelables, révocation.
// Le serveur MCP est livré désactivé (MCP_ACTIF=false).

import { mcp as mcpPlugin, requireMcpAuth } from '@better-auth/mcp'
import { eq } from 'drizzle-orm'
import { sessions, vitrines } from '../../shared/db/schema'
import { db } from '../utils/db'
import { ForbiddenError, UnauthorizedError } from '../exceptions/http'
import { estCapacitePayante } from '../../shared/plans'
import { getPlanEffectif } from '../services/plans'

export type Scope = 'vitrine:lecture' | 'contenu:ecriture' | 'reservations:lecture' | 'messages:lecture'

export const TOUTES_PORTÉES: readonly Scope[] = [
  'vitrine:lecture',
  'contenu:ecriture',
  'reservations:lecture',
  'messages:lecture',
]

/** Vérifie que le serveur MCP est activé. */
export function verifierMcpActif(mcpActif: boolean): void {
  if (!mcpActif) {
    throw new ForbiddenError('MCP_INACTIF')
  }
}

/** Extrait le jeton Bearer de l'en-tête Authorization. */
function extraireJetonBearer(authorization: string | undefined): string | null {
  if (!authorization || !authorization.startsWith('Bearer ')) return null
  return authorization.slice(7).trim()
}

/** Valide un jeton d'accès MCP et retourne l'utilisateur. */
export async function authentifierMcp(authorization: string | undefined): Promise<{ userId: string }> {
  const jeton = extraireJetonBearer(authorization)
  if (!jeton) {
    throw new UnauthorizedError('AUTHENTIFICATION_REQUISE')
  }

  const [session] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.token, jeton))
    .limit(1)

  if (!session) {
    throw new UnauthorizedError('JETON_INVALIDE')
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('JETON_EXPIRE')
  }

  return { userId: session.userId }
}

/** Vérifie que l'utilisateur a un plan payant (actif ou en grâce). */
export async function verifierPlanPayant(userId: string): Promise<void> {
  const plan = await getPlanEffectif(userId)
  if (plan.plan !== 'payant') {
    throw new ForbiddenError('PLAN_PAYANT_REQUIS')
  }
}

/** Vérifie que les portées requises par l'outil sont accordées. */
export function verifierPortées(
  requises: readonly Scope[],
  accordees: readonly Scope[],
): void {
  const manquantes = requises.filter((p) => !accordees.includes(p))
  if (manquantes.length > 0) {
    throw new ForbiddenError('PORTÉE_INSUFFISANTE')
  }
}

/** Vérifie qu'une capacité est réservée au plan payant. */
export function estCapaciteMcp(capacite: string): boolean {
  return estCapacitePayante(capacite)
}

/** Résout la vitrine de l'utilisateur pour le contexte MCP. */
export async function resoudreVitrine(userId: string): Promise<string> {
  const [vitrine] = await db
    .select({ id: vitrines.id })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  if (!vitrine) throw new ForbiddenError('VITRINE_INTROUVABLE')
  return vitrine.id
}

/** Middleware MCP : expose `requireMcpAuth` pour protection de la route /mcp. */
export { requireMcpAuth, mcpPlugin }
