import { and, inArray, lt } from 'drizzle-orm'
import { emailsTransactionnels } from '../../../shared/db/schema'
import { OUTBOX_RETENTION_JOURS } from '../../../shared/notifications'
import type { EmailStatut } from '../../../shared/notifications'
import { JOUR_MS } from '../../../shared/temps'
import { db } from '../../utils/db'

// S9 (docs/specs/S9-notifications.md #97) : rétention de l'outbox. Les lignes TERMINALES (envoyée, en échec
// définitif, annulée) de plus de OUTBOX_RETENTION_JOURS sont supprimées. L'âge se mesure sur `updated_at` (la
// dernière transition), jamais sur la création. Une ligne `en_attente` ou `en_cours` n'est jamais touchée.
// Les lignes ne contiennent que des identifiants (aucune adresse, aucun contenu).

/** Garder synchronisé avec l'index partiel `emails_transactionnels_terminal_idx` (migration 0020). */
const STATUTS_TERMINAUX: readonly EmailStatut[] = ['envoye', 'echec', 'annule']

/** Supprime les lignes terminales trop anciennes et renvoie leur nombre. Idempotent. */
export async function purgeOutbox(now: Date = new Date(), database: typeof db = db): Promise<number> {
  const limite = new Date(now.getTime() - OUTBOX_RETENTION_JOURS * JOUR_MS)
  const resultat = await database
    .delete(emailsTransactionnels)
    .where(and(
      inArray(emailsTransactionnels.statut, [...STATUTS_TERMINAUX]),
      lt(emailsTransactionnels.updatedAt, limite),
    ))
  return resultat.rowCount ?? 0
}
