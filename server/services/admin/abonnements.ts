// A3 (D-A3-07, D-A3-14) : onglets d'abonnements et rappel manuel « envoyer maintenant ».
import { and, asc, count, desc, eq, gt, like, lte, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import { ABONNEMENT_ONGLETS } from '../../../shared/admin-paiements'
import type { AbonnementOnglet } from '../../../shared/admin-paiements'
import { abonnements, emailsTransactionnels, paiements, users } from '../../../shared/db/schema'
import {
  ADMIN_ABONNEMENT_EXPIRES_FENETRE_JOURS,
  ADMIN_ABONNEMENT_RENOUVELLEMENT_JOURS,
  ADMIN_RAPPEL_INTERVALLE_HEURES,
} from '../../../shared/limites'
import { ABONNEMENT_GRACE_JOURS } from '../../../shared/plans'
import type { EtatAbonnement } from '../../../shared/plans'
import type { ListeAbonnementsQuery, RappelAbonnement } from '../../../shared/schemas/admin-paiements'
import { HEURE_MS, JOUR_MS } from '../../../shared/temps'
import { ConflictError, NotFoundError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { insertScheduledEmailEvents } from '../email-outbox'
import {
  OCCURRENCE_RAPPEL_MANUEL_PREFIXE,
  construireOccurrenceRappelManuel,
} from '../notifications/pertinence'
import { lireGraceJours, resoudrePlanEffectif } from '../plans'
import { enregistrer } from './audit'
import type { ActeurAdmin } from './paiements-journal'

/** Fenêtre d'un onglet : `expire_le > apres` ET `expire_le <= jusqua`. */
export interface FenetreOnglet {
  apres: Date
  jusqua: Date
}

/**
 * Fenêtres des trois onglets (PURE, `now` passé). Elles forment une PARTITION sans recouvrement :
 *  - renouvellement : `now < expire_le <= now + 7 j` ;
 *  - grâce : `now - 7 j < expire_le <= now` ;
 *  - expirés : `now - 37 j < expire_le <= now - 7 j`.
 */
export function fenetreOnglet(onglet: AbonnementOnglet, now: Date, graceJours: number = ABONNEMENT_GRACE_JOURS): FenetreOnglet {
  const instant = now.getTime()
  const finGrace = instant - graceJours * JOUR_MS
  switch (onglet) {
    case 'renouvellement':
      return { apres: now, jusqua: new Date(instant + ADMIN_ABONNEMENT_RENOUVELLEMENT_JOURS * JOUR_MS) }
    case 'grace':
      return { apres: new Date(finGrace), jusqua: now }
    case 'expires':
      return { apres: new Date(finGrace - ADMIN_ABONNEMENT_EXPIRES_FENETRE_JOURS * JOUR_MS), jusqua: new Date(finGrace) }
  }
}

/** Onglet d'un abonnement à cet instant, ou `null` (échéance lointaine ou expirée depuis trop longtemps). PURE. */
export function ongletAbonnement(expireLe: Date, now: Date, graceJours: number = ABONNEMENT_GRACE_JOURS): AbonnementOnglet | null {
  const echeance = expireLe.getTime()
  return ABONNEMENT_ONGLETS.find((onglet) => {
    const { apres, jusqua } = fenetreOnglet(onglet, now, graceJours)
    return echeance > apres.getTime() && echeance <= jusqua.getTime()
  }) ?? null
}

export interface AbonnementAdmin {
  id: string
  utilisateur: { id: string, email: string }
  plan: string
  devise: string
  expireLe: Date
  etat: EtatAbonnement
  origine: string
  dernierPaiement: { id: string, statut: string, montant: number, devise: string, creeLe: Date } | null
}

export interface ListeAbonnementsAdmin {
  onglet: AbonnementOnglet
  elements: AbonnementAdmin[]
  total: number
  page: number
  limite: number
}

export async function listerAbonnements(query: ListeAbonnementsQuery, now: Date = new Date()): Promise<ListeAbonnementsAdmin> {
  const { onglet, page, limite } = query
  const graceJours = await lireGraceJours()
  const { apres, jusqua } = fenetreOnglet(onglet, now, graceJours)
  const where = and(gt(abonnements.expireLe, apres), lte(abonnements.expireLe, jusqua))
  // Les plus proches de l'échéance d'abord, sauf les expirés (les plus récemment échus d'abord).
  const ordre = onglet === 'expires' ? desc(abonnements.expireLe) : asc(abonnements.expireLe)
  const [lignes, totaux] = await Promise.all([
    db
      .select({
        id: abonnements.id,
        userId: users.id,
        email: users.email,
        fuseau: users.fuseau,
        deviseCompte: users.devise,
        plan: abonnements.plan,
        expireLe: abonnements.expireLe,
        origine: abonnements.origine,
        paiementId: paiements.id,
        paiementStatut: paiements.statut,
        paiementMontant: paiements.montant,
        paiementDevise: paiements.devise,
        paiementCreeLe: paiements.createdAt,
      })
      .from(abonnements)
      .innerJoin(users, eq(users.id, abonnements.userId))
      .leftJoin(paiements, eq(paiements.id, abonnements.dernierPaiementId))
      .where(where)
      .orderBy(ordre, asc(abonnements.id))
      .limit(limite)
      .offset((page - 1) * limite),
    db.select({ total: count() }).from(abonnements).where(where),
  ])
  const elements = lignes.map((ligne): AbonnementAdmin => ({
    id: ligne.id,
    utilisateur: { id: ligne.userId, email: ligne.email },
    plan: ligne.plan,
    devise: ligne.deviseCompte,
    expireLe: ligne.expireLe,
    etat: resoudrePlanEffectif({ plan: ligne.plan, expireLe: ligne.expireLe }, now, ligne.fuseau, graceJours).etat,
    origine: ligne.origine,
    dernierPaiement: ligne.paiementId !== null && ligne.paiementStatut !== null && ligne.paiementMontant !== null
      && ligne.paiementDevise !== null && ligne.paiementCreeLe !== null
      ? { id: ligne.paiementId, statut: ligne.paiementStatut, montant: ligne.paiementMontant, devise: ligne.paiementDevise, creeLe: ligne.paiementCreeLe }
      : null,
  }))
  return { onglet, elements, total: totaux[0]?.total ?? 0, page, limite }
}

/**
 * Rappel « envoyer maintenant » (D-A3-07) : une ligne d'outbox `abonnement_rappel`, occurrence `MANUEL:<ISO>`, catégorie
 * `transactionnel`. Un par abonnement et par `ADMIN_RAPPEL_INTERVALLE_HEURES` heures, vérifié SOUS verrou consultatif
 * (deux demandes simultanées : une seule ligne). Refusé si l'abonnement est échu. Le jour restant est calculé à l'envoi.
 */
export async function rappelerAbonnement(
  acteur: ActeurAdmin,
  abonnementId: string,
  entree: RappelAbonnement,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rappel-admin:${abonnementId}`}, 0))`)
    const [abonnement] = await tx
      .select({ id: abonnements.id, expireLe: abonnements.expireLe })
      .from(abonnements)
      .where(eq(abonnements.id, abonnementId))
    if (abonnement === undefined) throw new NotFoundError('ABONNEMENT_INTROUVABLE')
    if (abonnement.expireLe.getTime() <= now.getTime()) throw new ConflictError('ABONNEMENT_ECHU')

    const depuis = new Date(now.getTime() - ADMIN_RAPPEL_INTERVALLE_HEURES * HEURE_MS)
    const [recent] = await tx
      .select({ id: emailsTransactionnels.id })
      .from(emailsTransactionnels)
      .where(and(
        eq(emailsTransactionnels.type, 'abonnement_rappel'),
        eq(emailsTransactionnels.entiteType, 'abonnement'),
        eq(emailsTransactionnels.entiteId, abonnement.id),
        like(emailsTransactionnels.occurrence, `${OCCURRENCE_RAPPEL_MANUEL_PREFIXE}%`),
        gt(emailsTransactionnels.createdAt, depuis),
      ))
      .limit(1)
    if (recent !== undefined) throw new ConflictError('RAPPEL_RECENT')

    const creees = await insertScheduledEmailEvents(tx, [{
      entiteType: 'abonnement',
      entiteId: abonnement.id,
      type: 'abonnement_rappel',
      occurrence: construireOccurrenceRappelManuel(now),
      prochaineTentative: now,
      categorie: 'transactionnel',
      creeLe: now,
    }])
    if (creees === 0) throw new ConflictError('RAPPEL_RECENT')

    await enregistrer(tx, {
      adminId: acteur.adminId,
      action: ADMIN_ACTIONS.abonnementRappeler,
      cibleType: ADMIN_CIBLES.abonnement,
      cibleId: abonnement.id,
      avant: null,
      apres: null,
      motif: entree.motif,
      ip: acteur.ip,
    })
  })
}
