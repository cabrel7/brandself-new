// A1 (D-A1-10) : création et réinitialisation d'un compte superadmin, par COMMANDE SERVEUR uniquement
// (`pnpm admin:creer`, `pnpm admin:reinitialiser`) : aucune route HTTP ne crée ni ne promeut un administrateur.
// Chaque commande = UNE transaction qui écrit le compte ET sa ligne de journal (motif « commande serveur », IP `cli`).
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, SUPERADMIN } from '../../../shared/admin'
import { sessions, users } from '../../../shared/db/schema'
import { db } from '../../utils/db'
import { enregistrer } from './audit'

export const MOTIF_COMMANDE_SERVEUR = 'commande serveur'
export const IP_COMMANDE_SERVEUR = 'cli'
const CIBLE_TYPE_UTILISATEUR = 'utilisateur'

/** Aucun superadmin pour l'adresse donnée (le message ne la reprend pas). */
export class CompteIntrouvableError extends Error {
  constructor() {
    super('Aucun superadmin avec cette adresse.')
    this.name = 'CompteIntrouvableError'
  }
}

export interface ResultatSuperadmin {
  adminId: string
  /** `true` si le compte n'existait pas et a été créé. */
  cree: boolean
}

/**
 * Crée le compte (adresse vérifiée, rôle superadmin) ou promeut le compte existant. N'enlève jamais une
 * suspension : c'est le rôle de `reinitialiserSuperadmin`. L'adresse est enregistrée en minuscules (comme Better Auth).
 */
export async function creerSuperadmin(adresse: string): Promise<ResultatSuperadmin> {
  const email = adresse.trim().toLowerCase()
  return db.transaction(async (tx) => {
    const [existant] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email)).limit(1)
    let adminId: string
    if (existant) {
      adminId = existant.id
      await tx.update(users).set({ role: SUPERADMIN, emailVerified: true, updatedAt: new Date() }).where(eq(users.id, adminId))
    } else {
      adminId = randomUUID()
      await tx.insert(users).values({ id: adminId, name: '', email, emailVerified: true, role: SUPERADMIN })
    }
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.superadminCreer,
      cibleType: CIBLE_TYPE_UTILISATEUR,
      cibleId: adminId,
      avant: { role: existant?.role ?? null },
      apres: { role: SUPERADMIN },
      motif: MOTIF_COMMANDE_SERVEUR,
      ip: IP_COMMANDE_SERVEUR,
    })
    return { adminId, cree: existant === undefined }
  })
}

/**
 * Récupération d'un accès : lève la suspension, supprime TOUTES les sessions du compte et
 * ses réauthentifications ouvertes. Le compte doit DÉJÀ être superadmin (la commande ne crée ni ne promeut rien).
 */
export async function reinitialiserSuperadmin(adresse: string): Promise<{ adminId: string }> {
  const email = adresse.trim().toLowerCase()
  return db.transaction(async (tx) => {
    const [existant] = await tx
      .select({ id: users.id, role: users.role, suspendu: users.banned })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    // Pas de promotion ici (réservée à `admin:creer`) : un compte ordinaire n'est pas modifié.
    if (!existant || existant.role !== SUPERADMIN) throw new CompteIntrouvableError()
    await tx
      .update(users)
      .set({ role: SUPERADMIN, banned: false, banReason: null, banExpires: null, updatedAt: new Date() })
      .where(eq(users.id, existant.id))
    await tx.delete(sessions).where(eq(sessions.userId, existant.id))
    await tx.execute(sql`DELETE FROM admin_reauth WHERE admin_id = ${existant.id} AND consomme_le IS NULL`)
    await enregistrer(tx, {
      adminId: existant.id,
      action: ADMIN_ACTIONS.superadminReinitialiser,
      cibleType: CIBLE_TYPE_UTILISATEUR,
      cibleId: existant.id,
      avant: { role: existant.role, suspendu: existant.suspendu },
      apres: { role: SUPERADMIN, suspendu: false },
      motif: MOTIF_COMMANDE_SERVEUR,
      ip: IP_COMMANDE_SERVEUR,
    })
    return { adminId: existant.id }
  })
}
