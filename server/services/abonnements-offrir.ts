// A2 (D-A2-04, D-A2-05) : écriture de l'abonnement par l'administration. Service dédié, jamais une écriture
// directe depuis une route. Dans la transaction de l'appelant ; le verrou consultatif `abonnement:<userId>` (le même
// que `prolonger`, paiements/application.ts) sérialise toute écriture de l'abonnement d'un compte.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { AbonnementOrigine } from '../../shared/admin-a2'
import { abonnements } from '../../shared/db/schema'
import { PLAN_PAYANT_ID } from '../config/plans'
import type { TransactionAdmin } from './admin/audit'
import { choisirBase } from './abonnements-regles'

const MS_PAR_JOUR = 86_400_000
const VERROU_ABONNEMENT_PREFIXE = 'abonnement:'
const ORIGINE_ESSAI = 'essai'

export interface EtatAbonnementEcrit {
  expireLe: Date
  origine: AbonnementOrigine
}

export interface ResultatOffre {
  abonnementId: string
  /** `null` : le compte n'avait aucune ligne d'abonnement. */
  avant: EtatAbonnementEcrit | null
  apres: EtatAbonnementEcrit
}

/** Échéance après `jours` jours offerts : `max(now, expire_le) + jours × 24 h` (pas d'arrondi à minuit : « exactement N jours »). */
export function calculerEcheanceOfferte(now: Date, expireLe: Date | null, jours: number): Date {
  return new Date(choisirBase(now, expireLe).getTime() + jours * MS_PAR_JOUR)
}

/** Verrou consultatif `abonnement:<userId>` (transactionnel, ré-entrant dans la transaction) : sérialise toute écriture de l'abonnement. */
export async function verrouiller(tx: TransactionAdmin, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${VERROU_ABONNEMENT_PREFIXE}${userId}`}, 0))`)
}

function versOrigine(valeur: string): AbonnementOrigine {
  return valeur === 'offert' || valeur === 'admin' || valeur === 'essai' ? valeur : 'paiement'
}

/** Origines qu'une CRÉATION par `offrirJours` peut porter (E1 : l'essai gratuit à la création de la vitrine). */
export type OrigineCreationOffre = Extract<AbonnementOrigine, 'offert' | 'essai'>

/**
 * Offre `jours` jours. Sans ligne : INSERT `plan='payant'`, `origine='offert'`, première activation = `now`. Avec une
 * ligne : UPDATE de `expire_le` (les paiements sont inchangés) ; l'origine est inchangée SAUF pour un essai (E1 D9) :
 * un essai prolongé par une offre devient un abonnement normal (`origineCreation`, avec sa grâce), sinon il resterait
 * sans grâce et verrait ses relances d'essai continuer.
 * `origineCreation` (E1) : origine de la ligne CRÉÉE, ou de l'offre qui remplace un essai ; `'offert'` par défaut ;
 * `'essai'` pour l'essai gratuit (jamais appliqué à une ligne existante : l'octroi refuse tout abonnement existant).
 */
export async function offrirJours(
  tx: TransactionAdmin,
  userId: string,
  jours: number,
  now: Date,
  origineCreation: OrigineCreationOffre = 'offert',
): Promise<ResultatOffre> {
  await verrouiller(tx, userId)
  const [existant] = await tx.select().from(abonnements).where(eq(abonnements.userId, userId)).for('update')
  const expireLe = calculerEcheanceOfferte(now, existant?.expireLe ?? null, jours)
  if (existant === undefined) {
    const id = randomUUID()
    await tx.insert(abonnements).values({
      id,
      userId,
      plan: PLAN_PAYANT_ID,
      expireLe,
      premiereActivationLe: now,
      dernierPaiementId: null,
      origine: origineCreation,
      createdAt: now,
      updatedAt: now,
    })
    return { abonnementId: id, avant: null, apres: { expireLe, origine: origineCreation } }
  }
  const origineAvant = versOrigine(existant.origine)
  const origineApres = origineAvant === ORIGINE_ESSAI ? origineCreation : origineAvant
  await tx.update(abonnements).set({ expireLe, origine: origineApres, updatedAt: now }).where(eq(abonnements.id, existant.id))
  return {
    abonnementId: existant.id,
    avant: { expireLe: existant.expireLe, origine: origineAvant },
    apres: { expireLe, origine: origineApres },
  }
}

/**
 * Passage au plan payant par l'administrateur (D-A2-05) : crée la ligne `origine='admin'` pour `jours` jours. Si une
 * ligne ÉCHUE existe (clé unique par compte), elle est rouverte : `expire_le = now + jours`, `origine='admin'`.
 */
export async function activerPayantParAdmin(tx: TransactionAdmin, userId: string, jours: number, now: Date): Promise<ResultatOffre> {
  await verrouiller(tx, userId)
  const [existant] = await tx.select().from(abonnements).where(eq(abonnements.userId, userId)).for('update')
  const expireLe = new Date(now.getTime() + jours * MS_PAR_JOUR)
  if (existant === undefined) {
    const id = randomUUID()
    await tx.insert(abonnements).values({
      id,
      userId,
      plan: PLAN_PAYANT_ID,
      expireLe,
      premiereActivationLe: now,
      dernierPaiementId: null,
      origine: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    return { abonnementId: id, avant: null, apres: { expireLe, origine: 'admin' } }
  }
  await tx.update(abonnements).set({ expireLe, origine: 'admin', updatedAt: now }).where(eq(abonnements.id, existant.id))
  return {
    abonnementId: existant.id,
    avant: { expireLe: existant.expireLe, origine: versOrigine(existant.origine) },
    apres: { expireLe, origine: 'admin' },
  }
}

/** Retour au plan gratuit (D-A2-05) : la ligne est SUPPRIMÉE, sans période de grâce ; les paiements restent. `false` : aucune ligne. */
export async function supprimerAbonnement(tx: TransactionAdmin, userId: string): Promise<boolean> {
  await verrouiller(tx, userId)
  const supprimes = await tx.delete(abonnements).where(eq(abonnements.userId, userId)).returning({ id: abonnements.id })
  return supprimes.length > 0
}
