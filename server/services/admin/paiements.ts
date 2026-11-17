// A3 : liste et détail des paiements pour l'administration. Lecture seule. Les colonnes sont CHOISIES une à une : le
// numéro du payeur (`telephone_masque`, `telephone_empreinte`) n'est jamais lu (D-A3-10), ni dans une liste, ni dans un
// export. Le seul champ personnel est l'e-mail du titulaire du compte (`null` si le compte est supprimé).
import { Temporal } from '@js-temporal/polyfill'
import { and, count, desc, eq, gte, lt } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { ADMIN_FICHE_LIGNES_MAX } from '../../../shared/admin-a2'
import { evenementsPaiement, paiements, users } from '../../../shared/db/schema'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import type { FiltresPaiements, ListePaiementsQuery } from '../../../shared/schemas/admin-paiements'
import { NotFoundError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { derniereReverificationNonReussie } from './paiements-journal'
import type { ExecuteurSql } from './audit'

/** Un paiement tel que l'administration le lit. Aucune colonne de téléphone : ce type est la liste blanche. */
export interface PaiementAdmin {
  id: string
  referenceFournisseur: string | null
  fournisseur: string
  source: string
  methode: string
  operateur: string | null
  statut: string
  plan: string
  periodeMois: number
  devise: string
  montant: number
  fraisReels: number | null
  netReel: number | null
  codeEchec: string | null
  creeLe: Date
  appliqueLe: Date | null
  termineLe: Date | null
  utilisateur: { id: string, email: string } | null
}

export interface EvenementPaiementAdmin {
  evenement: string
  source: string
  traitement: string
  motif: string | null
  recuLe: Date
}

export interface DetailPaiementAdmin {
  paiement: PaiementAdmin
  evenements: EvenementPaiementAdmin[]
  reverifieNonReussiLe: Date | null
}

export interface ListePaiementsAdmin {
  elements: PaiementAdmin[]
  total: number
  page: number
  limite: number
}

/** Colonnes lues (liste blanche) : partagées par la liste, le détail et l'export. */
export const COLONNES_PAIEMENT_ADMIN = {
  id: paiements.id,
  referenceFournisseur: paiements.referenceFournisseur,
  fournisseur: paiements.fournisseur,
  source: paiements.source,
  methode: paiements.methode,
  operateur: paiements.operateur,
  statut: paiements.statut,
  plan: paiements.plan,
  periodeMois: paiements.periodeMois,
  devise: paiements.devise,
  montant: paiements.montant,
  fraisReels: paiements.fraisReels,
  netReel: paiements.netReel,
  codeEchec: paiements.codeEchec,
  creeLe: paiements.createdAt,
  appliqueLe: paiements.appliqueLe,
  termineLe: paiements.termineLe,
  userId: paiements.userId,
  email: users.email,
} as const

interface LignePaiement {
  id: string
  referenceFournisseur: string | null
  fournisseur: string
  source: string
  methode: string
  operateur: string | null
  statut: string
  plan: string
  periodeMois: number
  devise: string
  montant: number
  fraisReels: number | null
  netReel: number | null
  codeEchec: string | null
  creeLe: Date
  appliqueLe: Date | null
  termineLe: Date | null
  userId: string | null
  email: string | null
}

export function versPaiementAdmin(ligne: LignePaiement): PaiementAdmin {
  return {
    id: ligne.id,
    referenceFournisseur: ligne.referenceFournisseur,
    fournisseur: ligne.fournisseur,
    source: ligne.source,
    methode: ligne.methode,
    operateur: ligne.operateur,
    statut: ligne.statut,
    plan: ligne.plan,
    periodeMois: ligne.periodeMois,
    devise: ligne.devise,
    montant: ligne.montant,
    fraisReels: ligne.fraisReels,
    netReel: ligne.netReel,
    codeEchec: ligne.codeEchec,
    creeLe: ligne.creeLe,
    appliqueLe: ligne.appliqueLe,
    termineLe: ligne.termineLe,
    utilisateur: ligne.userId !== null && ligne.email !== null ? { id: ligne.userId, email: ligne.email } : null,
  }
}

/** Début du jour `AAAA-MM-JJ` dans le fuseau de l'administration (`Africa/Douala`). */
function debutDeJour(jour: string, joursEnPlus = 0): Date {
  const debut = Temporal.PlainDate.from(jour).add({ days: joursEnPlus }).toZonedDateTime(ABONNEMENT_FUSEAU_REPLI)
  return new Date(debut.epochMilliseconds)
}

/**
 * Conditions des filtres (liste ET export : les mêmes). La période porte sur la date de création, jours inclus, dans le
 * fuseau de l'administration.
 */
export function conditionsFiltresPaiements(filtres: FiltresPaiements): SQL[] {
  const conditions: SQL[] = []
  if (filtres.statut !== undefined) conditions.push(eq(paiements.statut, filtres.statut))
  if (filtres.source !== undefined) conditions.push(eq(paiements.source, filtres.source))
  if (filtres.devise !== undefined) conditions.push(eq(paiements.devise, filtres.devise))
  if (filtres.du !== undefined) conditions.push(gte(paiements.createdAt, debutDeJour(filtres.du)))
  if (filtres.au !== undefined) conditions.push(lt(paiements.createdAt, debutDeJour(filtres.au, 1)))
  return conditions
}

export async function listerPaiements(query: ListePaiementsQuery): Promise<ListePaiementsAdmin> {
  const { page, limite, ...filtres } = query
  const where = and(...conditionsFiltresPaiements(filtres))
  const [lignes, totaux] = await Promise.all([
    db
      .select(COLONNES_PAIEMENT_ADMIN)
      .from(paiements)
      .leftJoin(users, eq(users.id, paiements.userId))
      .where(where)
      .orderBy(desc(paiements.createdAt), desc(paiements.id))
      .limit(limite)
      .offset((page - 1) * limite),
    db.select({ total: count() }).from(paiements).where(where),
  ])
  return { elements: lignes.map(versPaiementAdmin), total: totaux[0]?.total ?? 0, page, limite }
}

export async function lireDetailPaiement(id: string, executeur: ExecuteurSql = db): Promise<DetailPaiementAdmin> {
  const [ligne] = await db
    .select(COLONNES_PAIEMENT_ADMIN)
    .from(paiements)
    .leftJoin(users, eq(users.id, paiements.userId))
    .where(eq(paiements.id, id))
  if (ligne === undefined) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  const evenements = await db
    .select({
      evenement: evenementsPaiement.evenement,
      source: evenementsPaiement.source,
      traitement: evenementsPaiement.traitement,
      motif: evenementsPaiement.motif,
      recuLe: evenementsPaiement.recuLe,
    })
    .from(evenementsPaiement)
    .where(eq(evenementsPaiement.paiementId, id))
    .orderBy(desc(evenementsPaiement.recuLe))
    .limit(ADMIN_FICHE_LIGNES_MAX)
  return {
    paiement: versPaiementAdmin(ligne),
    evenements,
    reverifieNonReussiLe: await derniereReverificationNonReussie(executeur, id),
  }
}
