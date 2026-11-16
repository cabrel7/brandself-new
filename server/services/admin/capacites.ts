// A4 (D-A4-11) : capacités accordées par l'administration à un compte (`mcp` seulement), hors plan. Accorder exige
// une réauthentification et une clé d'idempotence ; révoquer pose `revoque_le` (la ligne reste : traçabilité). La lecture
// côté application est `aCapaciteAccordee` (services/plans.ts), sans cache : une révocation vaut au prochain appel.
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import { capacitesAccordees, users } from '../../../shared/db/schema'
import type { CapacitePayante } from '../../../shared/plans'
import { ConflictError, NotFoundError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { rejouerSiDejaFait, refuserCompteAdmin } from './a2-support'
import type { DepsEcritureReauth } from './a2-support'
import { enregistrer } from './audit'
import type { TransactionAdmin } from './audit'

export interface CapaciteVue {
  id: string
  utilisateurId: string
  capacite: CapacitePayante
  motif: string
  accordePar: string
  accordeLe: Date
  revoqueLe: Date | null
}

export interface ResultatCapacite {
  capacite: CapaciteVue
  rejoue: boolean
}

const COLONNES = {
  id: capacitesAccordees.id,
  utilisateurId: capacitesAccordees.userId,
  capacite: capacitesAccordees.capacite,
  motif: capacitesAccordees.motif,
  accordePar: capacitesAccordees.accordePar,
  accordeLe: capacitesAccordees.accordeLe,
  revoqueLe: capacitesAccordees.revoqueLe,
}

function versVue(ligne: { id: string, utilisateurId: string, capacite: string, motif: string, accordePar: string, accordeLe: Date, revoqueLe: Date | null }): CapaciteVue {
  return { ...ligne, capacite: ligne.capacite as CapacitePayante }
}

async function verrouillerCompte(tx: TransactionAdmin, id: string): Promise<{ role: string }> {
  const [compte] = await tx.select({ role: users.role }).from(users).where(eq(users.id, id)).for('update').limit(1)
  if (!compte) throw new NotFoundError('UTILISATEUR_INTROUVABLE')
  return compte
}

/** Réauthentification OBLIGATOIRE (`deps.reauth`). Une capacité déjà active : 409 `ETAT_DEJA_APPLIQUE`. */
export async function accorderCapacite(
  adminId: string,
  utilisateurId: string,
  capacite: CapacitePayante,
  motif: string,
  cleIdempotence: string,
  ip: string,
  deps: DepsEcritureReauth,
): Promise<ResultatCapacite> {
  return db.transaction(async (tx) => {
    const rejeu = await rejouerSiDejaFait(tx, adminId, cleIdempotence, {
      action: ADMIN_ACTIONS.capaciteAccorder,
      cibleType: ADMIN_CIBLES.utilisateur,
      cibleId: utilisateurId,
      motif,
      parametres: { capacite },
    })
    if (rejeu) {
      const [ligne] = await tx
        .select(COLONNES)
        .from(capacitesAccordees)
        .where(and(eq(capacitesAccordees.userId, utilisateurId), eq(capacitesAccordees.capacite, capacite)))
        .orderBy(capacitesAccordees.accordeLe)
        .limit(1)
      if (!ligne) throw new NotFoundError('UTILISATEUR_INTROUVABLE')
      return { capacite: versVue(ligne), rejoue: true }
    }

    const compte = await verrouillerCompte(tx, utilisateurId)
    refuserCompteAdmin(compte.role)
    await deps.reauth(tx)
    const [active] = await tx
      .select({ id: capacitesAccordees.id })
      .from(capacitesAccordees)
      .where(and(eq(capacitesAccordees.userId, utilisateurId), eq(capacitesAccordees.capacite, capacite), isNull(capacitesAccordees.revoqueLe)))
      .limit(1)
    if (active) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    const [creee] = await tx
      .insert(capacitesAccordees)
      .values({ id: randomUUID(), userId: utilisateurId, capacite, motif, accordePar: adminId })
      .returning(COLONNES)
    if (!creee) throw new Error('CAPACITE_SANS_RESULTAT')
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.capaciteAccorder,
      cibleType: ADMIN_CIBLES.utilisateur,
      cibleId: utilisateurId,
      avant: null,
      apres: { capacite },
      motif,
      ip,
      cleIdempotence,
    })
    return { capacite: versVue(creee), rejoue: false }
  })
}

/** Pas de réauthentification (D-A4). Aucune capacité active : 409 `ETAT_DEJA_APPLIQUE`. */
export async function revoquerCapacite(
  adminId: string,
  utilisateurId: string,
  capacite: CapacitePayante,
  motif: string,
  ip: string,
): Promise<CapaciteVue> {
  return db.transaction(async (tx) => {
    await verrouillerCompte(tx, utilisateurId)
    const [revoquee] = await tx
      .update(capacitesAccordees)
      .set({ revoqueLe: new Date() })
      .where(and(eq(capacitesAccordees.userId, utilisateurId), eq(capacitesAccordees.capacite, capacite), isNull(capacitesAccordees.revoqueLe)))
      .returning(COLONNES)
    if (!revoquee) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.capaciteRevoquer,
      cibleType: ADMIN_CIBLES.utilisateur,
      cibleId: utilisateurId,
      avant: { capacite },
      apres: null,
      motif,
      ip,
    })
    return versVue(revoquee)
  })
}
