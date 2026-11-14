// A1 (D-A1-08) : réauthentification d'une action destructrice. Code à 6 chiffres, empreinte HMAC-SHA256 (secret
// d'authentification), 10 minutes, 3 essais, lié au triplet (action, type de cible, cible), usage unique.
// Le code n'est jamais stocké en clair ni écrit dans un journal ; l'e-mail part APRÈS le commit (job).
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Queue } from 'bullmq'
import {
  ADMIN_REAUTH_CODE_FORMAT,
  ADMIN_REAUTH_ESSAIS,
  ADMIN_REAUTH_LIMITE,
  ADMIN_REAUTH_LIMITE_CLE_PREFIXE,
  ADMIN_REAUTH_TTL_S,
} from '../../../shared/admin'
import { env } from '../../../shared/env'
import { ForbiddenError } from '../../exceptions/http'
import { enfilerEmailReauth } from '../../jobs/admin-reauth'
import { db } from '../../utils/db'
import { enforceLimit } from '../limiteur'
import type { TransactionAdmin } from './audit'

/** Action et cible d'une confirmation. `cibleId` absent = action sans cible précise (réglage global). */
export interface PreuveReauth {
  action: string
  cibleType: string
  cibleId?: string | null
}

export interface ConsommationReauth extends PreuveReauth {
  code: string
}

export interface DemandeCodeDeps {
  queue?: Pick<Queue, 'add'>
}

const CODE_BORNE_EXCLUE = 1_000_000
const CODE_LONGUEUR = 6
const SEPARATEUR = '\0'

/**
 * Empreinte du code : HMAC-SHA256 (secret d'authentification) du code ET du triplet lié à l'administrateur. Un
 * code demandé pour une cible ne vaut donc rien pour une autre, même si la ligne était réécrite en base.
 */
export function empreinteCodeReauth(adminId: string, preuve: PreuveReauth, code: string): string {
  return createHmac('sha256', env.NUXT_BETTER_AUTH_SECRET)
    .update([adminId, preuve.action, preuve.cibleType, preuve.cibleId ?? '', code].join(SEPARATEUR))
    .digest('hex')
}

function egauxEnTempsConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Demande un code : écrit la ligne (l'éventuelle demande ouverte pour le même triplet est expirée), PUIS, après
 * le commit, met en file l'e-mail. Limité à 5 demandes / 15 min / administrateur (Redis ; indisponible = refus).
 */
export async function demanderCode(
  adminId: string,
  demande: PreuveReauth,
  deps: DemandeCodeDeps = {},
): Promise<{ expireLe: Date }> {
  await enforceLimit(
    `${ADMIN_REAUTH_LIMITE_CLE_PREFIXE}${adminId}`,
    ADMIN_REAUTH_LIMITE.limit,
    ADMIN_REAUTH_LIMITE.windowS,
    { failClosed: true },
  )
  const code = randomInt(0, CODE_BORNE_EXCLUE).toString().padStart(CODE_LONGUEUR, '0')
  const id = randomUUID()
  const cibleId = demande.cibleId ?? null
  const empreinte = empreinteCodeReauth(adminId, demande, code)

  const expireLe = await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE admin_reauth SET expire_le = now()
      WHERE admin_id = ${adminId} AND action = ${demande.action} AND cible_type = ${demande.cibleType}
        AND cible_id IS NOT DISTINCT FROM ${cibleId}::text
        AND consomme_le IS NULL AND expire_le > now()`)
    const resultat = await tx.execute<{ expire_le: Date | string }>(sql`
      INSERT INTO admin_reauth (id, admin_id, action, cible_type, cible_id, code_empreinte, expire_le)
      VALUES (${id}, ${adminId}, ${demande.action}, ${demande.cibleType}, ${cibleId}, ${empreinte},
              now() + make_interval(secs => ${ADMIN_REAUTH_TTL_S}))
      RETURNING expire_le`)
    const ligne = resultat.rows[0]
    if (!ligne) throw new Error('REAUTH_SANS_RESULTAT')
    return new Date(ligne.expire_le)
  })

  await enfilerEmailReauth({ reauthId: id, code }, deps.queue)
  return { expireLe }
}

/**
 * Consomme le code DANS la transaction de l'action : si l'action échoue ensuite, la transaction est annulée et le
 * code reste utilisable. Code absent, faux, expiré, épuisé ou déjà utilisé : même refus `REAUTH_INVALIDE`.
 *
 * L'essai est RÉSERVÉ de façon atomique avant toute comparaison (UPDATE … `essais < 3` sur `db`, en autocommit, donc
 * compté même si l'action est annulée) : sous appels parallèles, au plus 3 essais sont jamais comparés pour un code.
 */
export async function consommer(tx: TransactionAdmin, adminId: string, entree: ConsommationReauth): Promise<void> {
  if (!ADMIN_REAUTH_CODE_FORMAT.test(entree.code)) throw new ForbiddenError('REAUTH_INVALIDE')
  const cibleId = entree.cibleId ?? null
  const reservee = await db.execute<{ id: string, code_empreinte: string }>(sql`
    UPDATE admin_reauth SET essais = essais + 1
    WHERE id = (
      SELECT id FROM admin_reauth
      WHERE admin_id = ${adminId} AND action = ${entree.action} AND cible_type = ${entree.cibleType}
        AND cible_id IS NOT DISTINCT FROM ${cibleId}::text
        AND consomme_le IS NULL AND expire_le > now()
      ORDER BY cree_le DESC
      LIMIT 1)
      AND essais < ${ADMIN_REAUTH_ESSAIS}
    RETURNING id, code_empreinte`)
  const ligne = reservee.rows[0]
  if (!ligne) throw new ForbiddenError('REAUTH_INVALIDE')

  const attendue = empreinteCodeReauth(adminId, entree, entree.code)
  if (!egauxEnTempsConstant(ligne.code_empreinte, attendue)) throw new ForbiddenError('REAUTH_INVALIDE')

  // Usage unique, même sous concurrence : une seule transaction obtient la ligne. L'essai est déjà compté.
  const consommee = await tx.execute<{ id: string }>(sql`
    UPDATE admin_reauth SET consomme_le = now()
    WHERE id = ${ligne.id} AND consomme_le IS NULL AND expire_le > now()
    RETURNING id`)
  if (consommee.rows.length === 0) throw new ForbiddenError('REAUTH_INVALIDE')
}
