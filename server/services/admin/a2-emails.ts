// A2 (D-A2-14) : préparation des e-mails d'administration envoyés au titulaire (suspension, réactivation, jours
// offerts, dépublication). Appelée par `prepareEmail` (email-outbox.ts) pour les types de `ADMIN_A2_EMAIL_TYPES`.
// Fichier SANS import d'exécution de email-outbox.ts (types seulement) : pas de cycle.
import { eq, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import type { AdminA2EmailType } from '../../../shared/admin-a2'
import { TEMP_EMAIL_DOMAIN } from '../../../shared/compte'
import { users, vitrines } from '../../../shared/db/schema'
import { env } from '../../../shared/env'
import { isValidTimeZone } from '../../../shared/fuseau'
import type { CodeAnnulation } from '../../../shared/notifications'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import type { db } from '../../utils/db'
import type { EmailOutboxRow } from '../email-outbox'
import type { TransactionalEmailContent } from '../emails/contenus'

const OCCURRENCE_JOURNAL = /^\d{1,15}$/
/** Action de journal qui doit avoir produit chaque type d'e-mail : une occurrence qui désigne une autre entrée est refusée. */
const ACTION_PAR_TYPE: Readonly<Record<AdminA2EmailType, string>> = {
  utilisateur_suspendu: ADMIN_ACTIONS.utilisateurSuspendre,
  utilisateur_reactive: ADMIN_ACTIONS.utilisateurReactiver,
  utilisateur_jours_offerts: ADMIN_ACTIONS.utilisateurOffrirJours,
  utilisateur_depubliee: ADMIN_ACTIONS.vitrineDepublier,
}

export type PreparationAdminCompte = { contenu: TransactionalEmailContent } | { annule: CodeAnnulation }

function destinataireCompte(email: string, emailContact: string | null): string | null {
  if (!email.toLowerCase().endsWith(`@${TEMP_EMAIL_DOMAIN}`)) return email
  const contact = emailContact?.trim()
  return contact || null
}

/**
 * Prépare l'e-mail d'administration d'une ligne d'outbox (appelé par `prepareEmail` de email-outbox.ts) : charge le
 * compte et l'entrée de journal désignée par l'occurrence (le motif et les jours offerts y sont enregistrés). Une
 * ligne dont le compte a disparu ou dont l'entrée de journal est introuvable est annulée, jamais envoyée à moitié.
 * Aucune donnée de visiteur n'est lue.
 */
export async function preparerEmailAdminCompte(
  database: Pick<typeof db, 'select' | 'execute'>,
  row: Pick<EmailOutboxRow, 'id' | 'type' | 'entiteId' | 'occurrence' | 'createdAt'>,
): Promise<PreparationAdminCompte> {
  if (!OCCURRENCE_JOURNAL.test(row.occurrence)) return { annule: 'ENTITE_INTROUVABLE' }
  const [compte] = await database
    .select({ email: users.email, fuseau: users.fuseau, prenom: vitrines.prenom, emailContact: vitrines.emailContact })
    .from(users)
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .where(eq(users.id, row.entiteId))
    .limit(1)
  if (!compte) return { annule: 'ENTITE_INTROUVABLE' }
  const destinataire = destinataireCompte(compte.email, compte.emailContact)
  if (destinataire === null) return { annule: 'DESTINATAIRE_ABSENT' }

  const action = (ACTION_PAR_TYPE as Readonly<Record<string, string | undefined>>)[row.type]
  if (action === undefined) return { annule: 'ENTITE_INTROUVABLE' }
  // Défense en profondeur : l'entrée doit viser CE compte. Suspension, réactivation, jours offerts : `cible_id` = id du
  // compte ; dépublication : `cible_id` = id de la vitrine, qui doit appartenir à ce compte.
  const cibleDuCompte = row.type === 'utilisateur_depubliee'
    ? sql`cible_id IN (SELECT id FROM vitrines WHERE user_id = ${row.entiteId})`
    : sql`cible_id = ${row.entiteId}`
  const journal = await database.execute<{ motif: string, apres: Record<string, unknown> | null }>(sql`
    SELECT motif, apres FROM journal_admin
    WHERE numero = ${Number(row.occurrence)} AND action = ${action} AND ${cibleDuCompte}
    LIMIT 1`)
  const entree = journal.rows[0]
  if (!entree) return { annule: 'ENTITE_INTROUVABLE' }

  const base = {
    outboxId: row.id,
    generatedAt: row.createdAt,
    destinataire,
    prenom: compte.prenom ?? '',
    fuseau: isValidTimeZone(compte.fuseau) ? compte.fuseau : ABONNEMENT_FUSEAU_REPLI,
    siteUrl: env.NUXT_PUBLIC_SITE_URL,
  }
  switch (row.type) {
    case 'utilisateur_suspendu':
      return { contenu: { ...base, type: 'utilisateur_suspendu', motif: entree.motif } }
    case 'utilisateur_depubliee':
      return { contenu: { ...base, type: 'utilisateur_depubliee', motif: entree.motif } }
    case 'utilisateur_reactive':
      return { contenu: { ...base, type: 'utilisateur_reactive' } }
    case 'utilisateur_jours_offerts': {
      const jours = entree.apres?.jours
      const expire = entree.apres?.expire_le
      if (typeof jours !== 'number' || typeof expire !== 'string') return { annule: 'ENTITE_INTROUVABLE' }
      return { contenu: { ...base, type: 'utilisateur_jours_offerts', jours, expireLe: new Date(expire) } }
    }
    default:
      return { annule: 'ENTITE_INTROUVABLE' }
  }
}

