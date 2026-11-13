// S16 : autorisation du serveur MCP.
// L'authentification (signature, émetteur, audience, expiration du jeton d'accès JWT) est faite par
// `requireMcpAuth` de @better-auth/mcp (server/mcp/http.ts). Ce module en tire le contexte d'appel et applique
// les gardes propres à l'application : serveur activé, plan payant, portées consenties, vitrine existante.
// Le serveur MCP est livré désactivé (MCP_ACTIF=false).

import { eq } from 'drizzle-orm'
import { vitrines } from '../../shared/db/schema'
import { MCP_PORTEES } from '../../shared/mcp'
import type { McpPortee } from '../../shared/mcp'
import { db } from '../utils/db'
import { ForbiddenError } from '../exceptions/http'
import { PLAN_PAYANT_ID } from '../config/plans'
import { getPlanEffectif } from '../services/plans'
import { getPortéesConsenties } from '../services/assistants'

export type Scope = McpPortee

export const TOUTES_PORTÉES: readonly Scope[] = MCP_PORTEES

/** Claims du jeton d'accès (JWT) tels que fournis par @better-auth/mcp après vérification. */
export type ClaimsJeton = Readonly<Record<string, unknown>>

/** Identité d'un appel, lue dans le jeton d'accès (déjà vérifié) : `sub` = utilisateur, `azp` = client OAuth. */
export interface IdentiteJeton {
  userId: string
  clientId: string
  portéesJeton: string[]
}

/** Vérifie que le serveur MCP est activé. */
export function verifierMcpActif(mcpActif: boolean): void {
  if (!mcpActif) {
    throw new ForbiddenError('MCP_INACTIF')
  }
}

/** Extrait l'identité des claims JWT ; `null` si un claim indispensable manque (jeton inutilisable). */
export function lireIdentiteJeton(claims: ClaimsJeton): IdentiteJeton | null {
  const { sub, azp, scope } = claims
  if (typeof sub !== 'string' || sub === '' || typeof azp !== 'string' || azp === '') return null
  const portéesJeton = typeof scope === 'string' ? scope.split(' ').filter((portee) => portee !== '') : []
  return { userId: sub, clientId: azp, portéesJeton }
}

/**
 * Portées effectives = portées du jeton ∩ portées actuellement consenties. `null` si le consentement a été
 * révoqué : le jeton (valable jusqu'à son expiration) n'ouvre alors plus rien.
 */
export async function résoudrePortées(identite: IdentiteJeton): Promise<Scope[] | null> {
  const consenties = await getPortéesConsenties(identite.userId, identite.clientId)
  if (consenties === null) return null
  return consenties.filter((portee) => identite.portéesJeton.includes(portee))
}

/** Vérifie que l'utilisateur a un plan payant (actif ou en grâce). */
export async function verifierPlanPayant(userId: string): Promise<void> {
  const plan = await getPlanEffectif(userId)
  if (plan.plan !== PLAN_PAYANT_ID) {
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
    throw new ForbiddenError('PORTÉE_INSUFFISANTE', { manquantes })
  }
}

export interface VitrineMcp {
  id: string
  username: string
  fuseau: string
}

/** Résout la vitrine de l'utilisateur pour le contexte MCP (une seule requête : identifiant, adresse, fuseau). */
export async function resoudreVitrine(userId: string): Promise<VitrineMcp> {
  const [vitrine] = await db
    .select({ id: vitrines.id, username: vitrines.username, fuseau: vitrines.fuseau })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  if (!vitrine) throw new ForbiddenError('VITRINE_INTROUVABLE')
  return vitrine
}
