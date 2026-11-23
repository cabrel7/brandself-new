import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { abonnements, essais, users } from '../../../shared/db/schema'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import { PLAN_PAYANT_ID } from '../../config/plans'
import { calculerNouvelleEcheance, choisirBase, fuseauEffectif } from '../abonnements-regles'
import type { DbTransaction } from '../email-outbox'

// S10 (docs/specs/S10-abonnements.md §1 #120) : prolongation de l'abonnement. Extraite de `application.ts` (A3) pour
// que `confirmerPaiement` (confirmation.ts) et `appliquerEvenement` (application.ts) n'aient pas d'import circulaire.
// `application.ts` la ré-exporte : les appelants existants (`services/abonnements.ts`) ne changent pas.

export interface ResultatProlongation {
  abonnementId: string
  /** Échéance avant le paiement (`null` : première activation). */
  avant: Date | null
  apres: Date
}

/**
 * E1 (D11) : un vrai paiement convertit l'essai du compte. `converti_le` est posé UNE fois (`IS NULL`) : une 2e
 * confirmation ne le modifie pas. Sans essai pour ce compte, aucune ligne n'est touchée. Sans `paiementId` (aucun
 * paiement derrière), rien n'est converti. Même transaction que la prolongation : les deux réussissent ou échouent ensemble.
 */
async function marquerEssaiConverti(tx: DbTransaction, userId: string, paiementId: string | null, now: Date): Promise<void> {
  if (paiementId === null) return
  await tx.update(essais).set({ convertiLe: now }).where(and(eq(essais.userId, userId), isNull(essais.convertiLe)))
}

/**
 * Prolonge l'abonnement d'un utilisateur de `periodeMois` mois (#120), dans la transaction de l'appelant.
 * Sérialisée par utilisateur (verrou consultatif + `FOR UPDATE`) : deux paiements confirmés en parallèle ne
 * perdent aucune mise à jour. Base = `max(now, expire_le)` : en grâce ou en gratuit on repart de `now`.
 */
export async function prolonger(
  tx: DbTransaction,
  userId: string,
  periodeMois: number,
  now: Date,
  paiementId: string | null = null,
): Promise<ResultatProlongation> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`abonnement:${userId}`}, 0))`)
  const [existant] = await tx.select().from(abonnements).where(eq(abonnements.userId, userId)).for('update')
  const [utilisateur] = await tx.select({ fuseau: users.fuseau }).from(users).where(eq(users.id, userId))
  const fuseau = fuseauEffectif(utilisateur?.fuseau ?? ABONNEMENT_FUSEAU_REPLI)
  const avant = existant?.expireLe ?? null
  const apres = calculerNouvelleEcheance(choisirBase(now, avant), periodeMois, fuseau)

  if (existant === undefined) {
    const id = randomUUID()
    await tx.insert(abonnements).values({
      id,
      userId,
      plan: PLAN_PAYANT_ID,
      expireLe: apres,
      premiereActivationLe: now,
      dernierPaiementId: paiementId,
      createdAt: now,
      updatedAt: now,
    })
    await marquerEssaiConverti(tx, userId, paiementId, now)
    return { abonnementId: id, avant, apres }
  }
  await tx
    .update(abonnements)
    .set({
      expireLe: apres,
      dernierPaiementId: paiementId,
      updatedAt: now,
      // Un vrai paiement (K-PAY ou manuel) fait de l'abonné un payant, même si l'abonnement était offert ou posé par l'admin.
      // Sans `paiementId` (aucun paiement derrière), l'origine reste inchangée.
      ...(paiementId === null ? {} : { origine: 'paiement' as const }),
    })
    .where(eq(abonnements.id, existant.id))
  await marquerEssaiConverti(tx, userId, paiementId, now)
  return { abonnementId: existant.id, avant, apres }
}
