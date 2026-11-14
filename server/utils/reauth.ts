// A1 (D-A1-08) : garde de réauthentification d'une action destructrice. À appeler DANS la transaction de l'action,
// après `requireSuperadmin` : si l'action échoue ensuite, la transaction est annulée et le code reste utilisable.
import { getRequestHeader } from 'h3'
import type { H3Event } from 'h3'
import { ADMIN_REAUTH_ENTETE } from '../../shared/admin'
import type { RateLimit } from '../../shared/limites'
import { ForbiddenError } from '../exceptions/http'
import type { TransactionAdmin } from '../services/admin/audit'
import { consommer } from '../services/admin/reauth'
import { enforceLimit } from '../services/limiteur'
import type { PreuveReauth } from '../services/admin/reauth'

/** Tentatives de confirmation (codes comparés) par administrateur : frein en plus des 3 essais par code. */
export const ADMIN_REAUTH_TENTATIVES_LIMITE: RateLimit = { limit: 10, windowS: 900 }
export const ADMIN_REAUTH_TENTATIVES_CLE_PREFIXE = 'admin-reauth-essai:'

/**
 * Lit le code dans l'en-tête `X-Admin-Reauth` et le consomme pour (action, type de cible, cible).
 * Absent ou vide : 403 `REAUTH_REQUISE` ; faux, expiré, épuisé, déjà utilisé ou lié à une autre cible : 403
 * `REAUTH_INVALIDE` (même réponse dans tous ces cas).
 */
export async function exigerReauth(
  event: H3Event,
  tx: TransactionAdmin,
  adminId: string,
  preuve: PreuveReauth,
): Promise<void> {
  const code = getRequestHeader(event, ADMIN_REAUTH_ENTETE)?.trim()
  if (!code) throw new ForbiddenError('REAUTH_REQUISE')
  await enforceLimit(
    `${ADMIN_REAUTH_TENTATIVES_CLE_PREFIXE}${adminId}`,
    ADMIN_REAUTH_TENTATIVES_LIMITE.limit,
    ADMIN_REAUTH_TENTATIVES_LIMITE.windowS,
    { failClosed: true },
  )
  await consommer(tx, adminId, { ...preuve, code })
}
