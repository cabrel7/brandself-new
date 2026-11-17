// A2 : briques d'ÉCRITURE partagées par les services d'administration des comptes, vitrines et assistants.
// Aucune route ni événement H3 ici. Chaque écriture appelle ces fonctions DANS sa transaction :
//  - verrous (idempotence, abonnement) ; - idempotence par `journal_admin.cle_idempotence` (D-A2-06) ;
//  - ligne d'outbox des e-mails d'administration (D-A2-14), atomique avec l'écriture ;
//  - révocation des accès OAuth (assistants) ; - garde « compte d'administration ».
import { and, eq, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { ADMIN_A2_EMAIL_ENTITE_TYPE } from '../../../shared/admin-a2'
import type { AdminA2EmailType } from '../../../shared/admin-a2'
import { SUPERADMIN } from '../../../shared/admin'
import { oauthAccessTokens, oauthConsents, oauthRefreshTokens } from '../../../shared/db/schema'
import { ConflictError, DomainError } from '../../exceptions/http'
import { insertScheduledEmailEvent } from '../email-outbox'
import type { TransactionAdmin } from './audit'

/** Hook de réauthentification (`exigerReauth` de la route) : appelé DANS la transaction de l'écriture destructrice. */
export type ExigerReauth = (tx: TransactionAdmin) => Promise<void>

/** Dépendances d'une écriture d'administration. `reauth` est fourni par la route pour les actions marquées « * ». */
export interface DepsEcriture {
  reauth?: ExigerReauth
  /** Horloge injectée (tests) ; défaut : maintenant. */
  maintenant?: Date
}

/**
 * Dépendances d'une écriture DESTRUCTRICE (suspendre, changer de plan, supprimer, dépublier) : `reauth` est
 * OBLIGATOIRE. Un appelant qui l'oublierait ne compile pas : jamais d'action destructrice sans réauthentification
 * par simple omission (fail closed).
 */
export interface DepsEcritureReauth extends DepsEcriture {
  reauth: ExigerReauth
}

const VERROU_IDEMPOTENCE_PREFIXE = 'admin-idempotence:'
const MESSAGE_COMPTE_ADMIN = 'Ce compte est un compte d’administration : cette action est impossible.'

export function horloge(deps: DepsEcriture): Date {
  return deps.maintenant ?? new Date()
}

/** 422 `COMPTE_ADMIN` : suspendre, supprimer ou déconnecter un compte d'administration est refusé. */
export function refuserCompteAdmin(role: string): void {
  if (role === SUPERADMIN) throw new DomainError('COMPTE_ADMIN', MESSAGE_COMPTE_ADMIN, 422)
}

// ---------------------------------------------------------------------------------------------
// Idempotence (D-A2-06)
// ---------------------------------------------------------------------------------------------

type ValeurApres = string | number | boolean | null

export interface JournalRejoue {
  action: string
  cibleType: string
  cibleId: string | null
  motif: string
  apres: Record<string, unknown>
}

/** Ce que la demande rejouée doit retrouver à l'identique dans l'entrée de journal (action, cible, motif, paramètres). */
export interface DemandeAttendue {
  action: string
  cibleType: string
  cibleId: string
  motif: string
  /** Clés de `apres` qui décrivent les paramètres de la demande (`jours`, `plan`) et leur valeur attendue. */
  parametres: Readonly<Record<string, ValeurApres>>
}

/**
 * Sérialise les demandes de même clé (verrou consultatif de transaction) puis relit l'entrée de journal qui porte
 * cette clé pour cet administrateur. `null` : première fois. Même clé et même demande : l'entrée enregistrée.
 * Même clé et demande différente : 409 `IDEMPOTENCE_CONFLIT`. À appeler AVANT la réauthentification : un rejeu
 * n'a pas à consommer un nouveau code.
 */
export async function rejouerSiDejaFait(
  tx: TransactionAdmin,
  adminId: string,
  cle: string,
  attendue: DemandeAttendue,
): Promise<JournalRejoue | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${VERROU_IDEMPOTENCE_PREFIXE}${adminId}:${cle}`}, 0))`)
  const resultat = await tx.execute<{
    action: string
    cible_type: string
    cible_id: string | null
    motif: string
    apres: Record<string, unknown> | null
  }>(sql`
    SELECT action, cible_type, cible_id, motif, apres FROM journal_admin
    WHERE admin_id = ${adminId} AND cle_idempotence = ${cle}
    LIMIT 1`)
  const ligne = resultat.rows[0]
  if (!ligne) return null
  const apres = ligne.apres ?? {}
  const identique = ligne.action === attendue.action
    && ligne.cible_type === attendue.cibleType
    && ligne.cible_id === attendue.cibleId
    && ligne.motif === attendue.motif
    && Object.entries(attendue.parametres).every(([cleParametre, valeur]) => apres[cleParametre] === valeur)
  if (!identique) throw new ConflictError('IDEMPOTENCE_CONFLIT')
  return { action: ligne.action, cibleType: ligne.cible_type, cibleId: ligne.cible_id, motif: ligne.motif, apres }
}

// ---------------------------------------------------------------------------------------------
// E-mails d'administration (D-A2-14)
// ---------------------------------------------------------------------------------------------

/**
 * Pose la ligne d'outbox DANS la transaction de l'écriture : jamais d'e-mail sans écriture, jamais d'écriture sans
 * e-mail. `occurrence` = numéro de l'entrée de journal en chaîne décimale (unique par action, ≤ 32 caractères,
 * `^[0-9A-Z:.-]*$`). Le tick de distribution de l'outbox l'envoie après le commit.
 */
export async function emettreEmailAdmin(
  tx: TransactionAdmin,
  entree: { userId: string, type: AdminA2EmailType, numeroJournal: number, maintenant: Date },
): Promise<void> {
  await insertScheduledEmailEvent(tx, {
    entiteType: ADMIN_A2_EMAIL_ENTITE_TYPE,
    entiteId: entree.userId,
    type: entree.type,
    occurrence: String(entree.numeroJournal),
    prochaineTentative: entree.maintenant,
    categorie: 'transactionnel',
    creeLe: entree.maintenant,
  })
}

/** Annule les e-mails d'administration encore en attente d'un compte (avant sa suppression : aucun e-mail au compte supprimé). */
export async function annulerEmailsEnAttenteDuCompte(tx: TransactionAdmin, userId: string, maintenant: Date): Promise<void> {
  await tx.execute(sql`
    UPDATE emails_transactionnels
    SET statut = 'annule', erreur_code = 'ENTITE_INTROUVABLE', prochaine_tentative = NULL, updated_at = ${maintenant.toISOString()}::timestamptz
    WHERE entite_type = ${ADMIN_A2_EMAIL_ENTITE_TYPE} AND entite_id = ${userId} AND statut = 'en_attente'`)
}

// ---------------------------------------------------------------------------------------------
// Accès OAuth des assistants (tables du plugin `mcp()` de Better Auth)
// ---------------------------------------------------------------------------------------------

/**
 * Supprime jetons d'accès, jetons de renouvellement et consentements d'un compte, pour un client (`clientId`) ou
 * pour tous. Même effet que `revokeAssistant` (services/assistants.ts), mais dans la transaction de l'appelant.
 * Renvoie le nombre de consentements supprimés. Un JWT déjà émis n'a pas de ligne : il cesse de valoir parce que le
 * consentement a disparu (portées lues à chaque appel) et que le compte suspendu est refusé (mcp/auth.ts).
 */
export async function revoquerAccesOauth(tx: TransactionAdmin, userId: string, clientId?: string): Promise<number> {
  const duClient = (colonneClient: PgColumn) =>
    clientId === undefined ? undefined : eq(colonneClient, clientId)
  await tx.delete(oauthAccessTokens).where(and(eq(oauthAccessTokens.userId, userId), duClient(oauthAccessTokens.clientId)))
  await tx.delete(oauthRefreshTokens).where(and(eq(oauthRefreshTokens.userId, userId), duClient(oauthRefreshTokens.clientId)))
  const supprimes = await tx
    .delete(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), duClient(oauthConsents.clientId)))
    .returning({ id: oauthConsents.id })
  return supprimes.length
}
