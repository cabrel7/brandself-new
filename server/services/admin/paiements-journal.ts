// A3 : lectures du journal d'administration propres aux paiements : rejeu par clé d'idempotence (D-A3-03, D-A3-04) et
// dernière revérification « non réussi ». Le journal est la SEULE mémoire de l'idempotence (aucune table de plus).
import { sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import { ConflictError } from '../../exceptions/http'
import type { ExecuteurSql } from './audit'

/** L'administrateur qui agit et son adresse (journal) : fournis par la route, jamais lus dans l'événement HTTP. */
export interface ActeurAdmin {
  adminId: string
  ip: string
}

/** Résultat d'une revérification qui autorise le marquage manuel (le fournisseur n'a PAS encaissé). */
export const RESULTAT_NON_REUSSI = 'non_reussi'

export interface EntreeRejeu {
  /** `apres` de la ligne de journal (objet plat), jamais `null` pour une action rejouable. */
  apres: Record<string, unknown>
}

type LigneRejeu = {
  action: string
  cible_type: string
  cible_id: string | null
  apres: Record<string, unknown> | null
}

/**
 * Relit la ligne de journal portant `(admin, clé)`. `null` : clé neuve. Clé déjà utilisée pour une AUTRE action ou une
 * AUTRE cible : 409 `IDEMPOTENCE_CONFLIT` (jamais de rejeu d'un résultat qui n'est pas celui de la demande).
 */
export async function lireRejeu(
  executeur: ExecuteurSql,
  adminId: string,
  cleIdempotence: string,
  action: string,
  cibleId: string,
): Promise<EntreeRejeu | null> {
  const resultat = await executeur.execute<LigneRejeu>(sql`
    SELECT action, cible_type, cible_id, apres FROM journal_admin
    WHERE admin_id = ${adminId} AND cle_idempotence = ${cleIdempotence}
    LIMIT 1`)
  const ligne = resultat.rows[0]
  if (ligne === undefined) return null
  if (ligne.action !== action || ligne.cible_type !== ADMIN_CIBLES.paiement || ligne.cible_id !== cibleId || ligne.apres === null) {
    throw new ConflictError('IDEMPOTENCE_CONFLIT')
  }
  return { apres: ligne.apres }
}

/** Instant de la dernière revérification « non réussi » du paiement, ou `null`. `depuis` borne la recherche (validité). */
export async function derniereReverificationNonReussie(
  executeur: ExecuteurSql,
  paiementId: string,
  depuis?: Date,
): Promise<Date | null> {
  const resultat = await executeur.execute<{ le: Date | string | null }>(sql`
    SELECT max(cree_le) AS le FROM journal_admin
    WHERE action = ${ADMIN_ACTIONS.paiementReverifier} AND cible_type = ${ADMIN_CIBLES.paiement}
      AND cible_id = ${paiementId} AND apres ->> 'resultat' = ${RESULTAT_NON_REUSSI}
      ${depuis === undefined ? sql`` : sql`AND cree_le > ${depuis.toISOString()}::timestamptz`}`)
  const le = resultat.rows[0]?.le
  return le === null || le === undefined ? null : new Date(le)
}
