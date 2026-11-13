import { and, desc, eq, max } from 'drizzle-orm'
import { journalAssistant, oauthAccessTokens, oauthClients, oauthConsents, oauthRefreshTokens } from '../../shared/db/schema'
import { env } from '../../shared/env'
import { MCP_CHEMIN, MCP_JOURNAL_LIMITE, MCP_PORTEES } from '../../shared/mcp'
import type { McpPortee } from '../../shared/mcp'
import { PLAN_PAYANT_ID } from '../config/plans'
import { NotFoundError } from '../exceptions/http'
import { db } from '../utils/db'
import { getPlanEffectif } from './plans'

// S16 : assistants connectés (consentements OAuth Better Auth) et journal de leurs actions.
// Les consentements, clients et jetons sont des tables du plugin `mcp()` ; ce service est le seul endroit
// de l'application qui les lit ou les supprime. Le périmètre est toujours l'utilisateur (`user_id`).

export interface AssistantConnecte {
  /** Identifiant du consentement (sert à révoquer). */
  id: string
  /** `client_id` OAuth : c'est aussi l'`assistant_id` du journal. */
  clientId: string
  nom: string | null
  portees: McpPortee[]
  connecteLe: Date
  derniereActiviteLe: Date | null
}

export interface AssistantsVue {
  actif: boolean
  adresse: string
  planPayant: boolean
  assistants: AssistantConnecte[]
}

export interface EntreeJournal {
  id: string
  assistantId: string
  assistantNom: string | null
  outil: string
  argumentsResume: unknown
  erreur: string | null
  avant: unknown
  apres: unknown
  createdAt: Date
}

function estPortee(valeur: string): valeur is McpPortee {
  return (MCP_PORTEES as readonly string[]).includes(valeur)
}

/** Seules nos portées métier sont exposées (jamais `offline_access`, qui n'est pas un droit sur la vitrine). */
function portéesMetier(valeurs: readonly string[]): McpPortee[] {
  return valeurs.filter(estPortee)
}

/** Adresse publique du serveur MCP (celle que l'utilisateur colle dans Claude ou ChatGPT). */
export function adresseServeurMcp(): string {
  return `${env.NUXT_PUBLIC_SITE_URL}${MCP_CHEMIN}`
}

/**
 * Portées que l'utilisateur a RÉELLEMENT consenties à ce client, `null` si le consentement n'existe plus
 * (révoqué). Lu à chaque appel MCP : un jeton d'accès JWT reste valable jusqu'à son expiration, c'est cette
 * lecture qui rend la révocation immédiate.
 */
export async function getPortéesConsenties(userId: string, clientId: string): Promise<McpPortee[] | null> {
  const lignes = await db
    .select({ scopes: oauthConsents.scopes })
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
  if (lignes.length === 0) return null
  return portéesMetier(lignes.flatMap((ligne) => ligne.scopes))
}

export async function getAssistantsView(userId: string): Promise<AssistantsVue> {
  const plan = await getPlanEffectif(userId)
  const consentements = await db
    .select({
      id: oauthConsents.id,
      clientId: oauthConsents.clientId,
      nom: oauthClients.name,
      scopes: oauthConsents.scopes,
      createdAt: oauthConsents.createdAt,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(eq(oauthConsents.userId, userId))
    .orderBy(desc(oauthConsents.createdAt))

  const activites = await db
    .select({ assistantId: journalAssistant.assistantId, derniere: max(journalAssistant.createdAt) })
    .from(journalAssistant)
    .where(eq(journalAssistant.userId, userId))
    .groupBy(journalAssistant.assistantId)
  const derniereParAssistant = new Map(activites.map((ligne) => [ligne.assistantId, ligne.derniere]))

  return {
    actif: env.MCP_ACTIF,
    adresse: adresseServeurMcp(),
    planPayant: plan.plan === PLAN_PAYANT_ID,
    assistants: consentements.map((ligne) => ({
      id: ligne.id,
      clientId: ligne.clientId,
      nom: ligne.nom,
      portees: portéesMetier(ligne.scopes),
      connecteLe: ligne.createdAt,
      derniereActiviteLe: derniereParAssistant.get(ligne.clientId) ?? null,
    })),
  }
}

/**
 * Révoque un assistant : supprime le consentement ET les jetons de ce client pour cet utilisateur (une seule
 * transaction). Les jetons d'accès JWT déjà émis cessent d'être acceptés tout de suite (consentement absent),
 * le renouvellement est impossible (jetons de renouvellement supprimés).
 */
export async function revokeAssistant(userId: string, consentementId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [consentement] = await tx
      .select({ clientId: oauthConsents.clientId })
      .from(oauthConsents)
      .where(and(eq(oauthConsents.id, consentementId), eq(oauthConsents.userId, userId)))
      .limit(1)
    if (!consentement) throw new NotFoundError('ASSISTANT_INTROUVABLE')

    const { clientId } = consentement
    // Les jetons d'accès liés à un jeton de renouvellement suivent par cascade ; on supprime aussi les autres.
    await tx.delete(oauthAccessTokens).where(and(eq(oauthAccessTokens.userId, userId), eq(oauthAccessTokens.clientId, clientId)))
    await tx.delete(oauthRefreshTokens).where(and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.clientId, clientId)))
    await tx.delete(oauthConsents).where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
  })
}

/** Dernières actions des assistants sur la vitrine de l'utilisateur (les plus récentes d'abord). */
export async function listJournalAssistant(userId: string): Promise<EntreeJournal[]> {
  const lignes = await db
    .select({
      id: journalAssistant.id,
      assistantId: journalAssistant.assistantId,
      assistantNom: oauthClients.name,
      outil: journalAssistant.outil,
      argumentsResume: journalAssistant.argumentsResume,
      resultat: journalAssistant.resultat,
      avant: journalAssistant.avant,
      apres: journalAssistant.apres,
      createdAt: journalAssistant.createdAt,
    })
    .from(journalAssistant)
    .leftJoin(oauthClients, eq(oauthClients.clientId, journalAssistant.assistantId))
    .where(eq(journalAssistant.userId, userId))
    .orderBy(desc(journalAssistant.createdAt))
    .limit(MCP_JOURNAL_LIMITE)

  return lignes.map(({ resultat, ...ligne }) => ({ ...ligne, erreur: lireErreur(resultat) }))
}

function lireErreur(resultat: unknown): string | null {
  if (typeof resultat !== 'object' || resultat === null) return null
  const erreur = (resultat as { erreur?: unknown }).erreur
  return typeof erreur === 'string' ? erreur : null
}
