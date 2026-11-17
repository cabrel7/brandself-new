// A2 (D-A2-15) : assistants connectés (consentements OAuth) vus et retirés par l'administration. Lecture : jamais de
// jeton ; écriture : une transaction, révocation identique à `revokeAssistant` (services/assistants.ts), journal.
import { desc, eq, max } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import { ADMIN_FICHE_LIGNES_MAX } from '../../../shared/admin-a2'
import { journalAssistant, oauthClients, oauthConsents, users } from '../../../shared/db/schema'
import { MCP_PORTEES } from '../../../shared/mcp'
import { NotFoundError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { enregistrer } from './audit'
import { revoquerAccesOauth } from './a2-support'

export interface AssistantVue {
  /** Identifiant du CONSENTEMENT (sert à retirer). */
  id: string
  /** Nom du client OAuth, sinon son identifiant public. */
  client: string
  portees: string[]
  dernierUsage: Date | null
}

type Lecteur = Pick<typeof db, 'select'>

/** Seules nos portées métier sont exposées (jamais `offline_access`). */
function porteesMetier(valeurs: readonly string[]): string[] {
  return valeurs.filter((valeur) => (MCP_PORTEES as readonly string[]).includes(valeur))
}

/** Assistants d'un compte, le plus récent d'abord, plafonnés. Ni jeton, ni secret, ni contenu des appels. */
export async function lireAssistants(lecteur: Lecteur, utilisateurId: string): Promise<AssistantVue[]> {
  const consentements = await lecteur
    .select({
      id: oauthConsents.id,
      clientId: oauthConsents.clientId,
      nom: oauthClients.name,
      scopes: oauthConsents.scopes,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(eq(oauthConsents.userId, utilisateurId))
    .orderBy(desc(oauthConsents.createdAt), desc(oauthConsents.id))
    .limit(ADMIN_FICHE_LIGNES_MAX)
  if (consentements.length === 0) return []
  const usages = await lecteur
    .select({ assistantId: journalAssistant.assistantId, dernier: max(journalAssistant.createdAt) })
    .from(journalAssistant)
    .where(eq(journalAssistant.userId, utilisateurId))
    .groupBy(journalAssistant.assistantId)
  const dernierParClient = new Map(usages.map((usage) => [usage.assistantId, usage.dernier]))
  return consentements.map((consentement) => ({
    id: consentement.id,
    client: consentement.nom?.trim() || consentement.clientId,
    portees: porteesMetier(consentement.scopes),
    dernierUsage: dernierParClient.get(consentement.clientId) ?? null,
  }))
}

/** `GET /api/admin/assistants?utilisateurId=` : 404 `UTILISATEUR_INTROUVABLE` si le compte n'existe pas. */
export async function listerAssistants(utilisateurId: string): Promise<AssistantVue[]> {
  const [compte] = await db.select({ id: users.id }).from(users).where(eq(users.id, utilisateurId)).limit(1)
  if (!compte) throw new NotFoundError('UTILISATEUR_INTROUVABLE')
  return lireAssistants(db, utilisateurId)
}

/**
 * Retire UN assistant (consentement, jetons d'accès et de renouvellement du même client pour ce compte). Motif seul
 * (D-A2-07). Consentement inconnu : 404 `ASSISTANT_INTROUVABLE`. Le journal ne porte aucun identifiant de client.
 */
export async function retirerAssistant(
  adminId: string,
  consentementId: string,
  motif: string,
  ip: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [consentement] = await tx
      .select({ id: oauthConsents.id, userId: oauthConsents.userId, clientId: oauthConsents.clientId })
      .from(oauthConsents)
      .where(eq(oauthConsents.id, consentementId))
      .for('update')
      .limit(1)
    if (!consentement) throw new NotFoundError('ASSISTANT_INTROUVABLE')
    if (consentement.userId === null) {
      await tx.delete(oauthConsents).where(eq(oauthConsents.id, consentement.id))
    } else {
      await revoquerAccesOauth(tx, consentement.userId, consentement.clientId)
    }
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.assistantRetirer,
      cibleType: ADMIN_CIBLES.assistant,
      cibleId: consentement.id,
      apres: { client_id_present: true },
      motif,
      ip,
    })
  })
}
