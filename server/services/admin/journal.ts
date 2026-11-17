// A4 (D-A4-18) : journal d'administration, lecture et export. `GET journal` et `GET journal/verifier` ne sont pas
// journalisés (lecture seule ; la vérification, qui recalcule toute la chaîne, est limitée à 5 par minute et par
// administrateur) ; l'export CSV exige un motif, est plafonné et JOURNALISÉ (`journal.exporter`) dans la même
// transaction que la lecture. Jamais d'adresse IP ni de clé d'idempotence en sortie.
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  ADMIN_ACTIONS,
  ADMIN_CIBLES,
  ADMIN_JOURNAL_VERIFICATION_CLE_PREFIXE,
  ADMIN_JOURNAL_VERIFICATION_LIMIT,
  EXPORT_JOURNAL_COLONNES,
} from '../../../shared/admin'
import type { ExportJournalColonne } from '../../../shared/admin'
import { journalAdmin } from '../../../shared/db/schema'
import { ADMIN_EXPORT_LIGNES_MAX } from '../../../shared/limites'
import type { ExportJournal, FiltresJournal, ListeJournalQuery } from '../../../shared/schemas/admin-a4'
import { JOUR_MS } from '../../../shared/temps'
import { UnprocessableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { construireCsv } from '../csv'
import { enforceLimit } from '../limiteur'
import { enregistrer, verifierChaine } from './audit'
import type { VerificationChaine } from './audit'
import type { PageAdmin } from './a2-lignes'
import type { ActeurAdmin } from './paiements-journal'

export interface JournalEntreeVue {
  id: string
  numero: number
  adminId: string
  action: string
  cibleType: string
  cibleId: string | null
  motif: string
  avant: Record<string, string | number | boolean | null> | null
  apres: Record<string, string | number | boolean | null> | null
  creeLe: Date
  empreinte: string
}

const COLONNES_JOURNAL = {
  id: journalAdmin.id,
  numero: journalAdmin.numero,
  adminId: journalAdmin.adminId,
  action: journalAdmin.action,
  cibleType: journalAdmin.cibleType,
  cibleId: journalAdmin.cibleId,
  motif: journalAdmin.motif,
  avant: journalAdmin.avant,
  apres: journalAdmin.apres,
  creeLe: journalAdmin.creeLe,
  empreinte: journalAdmin.empreinte,
}

function conditions(filtres: FiltresJournal): SQL[] {
  const liste: SQL[] = []
  if (filtres.adminId) liste.push(eq(journalAdmin.adminId, filtres.adminId))
  if (filtres.action) liste.push(eq(journalAdmin.action, filtres.action))
  if (filtres.cibleType) liste.push(eq(journalAdmin.cibleType, filtres.cibleType))
  if (filtres.cibleId) liste.push(eq(journalAdmin.cibleId, filtres.cibleId))
  // Jours en UTC : `du` inclus, `au` inclus (jusqu'au lendemain 00:00 exclu).
  if (filtres.du) liste.push(gte(journalAdmin.creeLe, new Date(`${filtres.du}T00:00:00.000Z`)))
  if (filtres.au) liste.push(lt(journalAdmin.creeLe, new Date(new Date(`${filtres.au}T00:00:00.000Z`).getTime() + JOUR_MS)))
  return liste
}

type EtatPlat = Record<string, string | number | boolean | null> | null
const etat = (valeur: unknown): EtatPlat => (valeur !== null && typeof valeur === 'object' ? (valeur as EtatPlat) : null)

function versVue(ligne: { id: string, numero: number, adminId: string, action: string, cibleType: string, cibleId: string | null, motif: string, avant: unknown, apres: unknown, creeLe: Date, empreinte: string }): JournalEntreeVue {
  return { ...ligne, avant: etat(ligne.avant), apres: etat(ligne.apres) }
}

export async function listerJournal(requete: ListeJournalQuery): Promise<PageAdmin<JournalEntreeVue>> {
  const { page, limite, ...filtres } = requete
  const ou = and(...conditions(filtres))
  const [lignes, total] = await Promise.all([
    db
      .select(COLONNES_JOURNAL)
      .from(journalAdmin)
      .where(ou)
      .orderBy(desc(journalAdmin.numero))
      .limit(limite)
      .offset((page - 1) * limite),
    db.select({ nombre: sql<number>`count(*)::int` }).from(journalAdmin).where(ou),
  ])
  return { elements: lignes.map(versVue), total: total[0]?.nombre ?? 0, page, limite }
}

function celluleEtat(valeur: EtatPlat): string {
  return valeur === null ? '' : JSON.stringify(valeur)
}

function valeurColonne(ligne: JournalEntreeVue, colonne: ExportJournalColonne): string {
  switch (colonne) {
    case 'numero': return String(ligne.numero)
    case 'creeLe': return ligne.creeLe.toISOString()
    case 'adminId': return ligne.adminId
    case 'action': return ligne.action
    case 'cibleType': return ligne.cibleType
    case 'cibleId': return ligne.cibleId ?? ''
    case 'motif': return ligne.motif
    case 'avant': return celluleEtat(ligne.avant)
    case 'apres': return celluleEtat(ligne.apres)
    case 'empreinte': return ligne.empreinte
  }
}

/** CSV du journal filtré (au plus `ADMIN_EXPORT_LIGNES_MAX`, sinon 422 `EXPORT_TROP_GRAND`), cellules neutralisées (CA13). */
export async function exporterJournalCsv(acteur: ActeurAdmin, entree: ExportJournal): Promise<string> {
  return db.transaction(async (tx) => {
    const lues = await tx
      .select(COLONNES_JOURNAL)
      .from(journalAdmin)
      .where(and(...conditions(entree.filtres)))
      .orderBy(desc(journalAdmin.numero))
      .limit(ADMIN_EXPORT_LIGNES_MAX + 1)
    if (lues.length > ADMIN_EXPORT_LIGNES_MAX) throw new UnprocessableError('EXPORT_TROP_GRAND')
    await enregistrer(tx, {
      adminId: acteur.adminId,
      action: ADMIN_ACTIONS.journalExporter,
      cibleType: ADMIN_CIBLES.journal,
      cibleId: null,
      avant: null,
      apres: { lignes: lues.length },
      motif: entree.motif,
      ip: acteur.ip,
    })
    const vues = lues.map(versVue)
    return construireCsv(EXPORT_JOURNAL_COLONNES, vues.map((ligne) => EXPORT_JOURNAL_COLONNES.map((colonne) => valeurColonne(ligne, colonne))))
  })
}

/** Recalcule la chaîne (limité à 5 par minute et par administrateur : 429 au-delà). */
export async function verifierChaineAdmin(adminId: string): Promise<VerificationChaine> {
  await enforceLimit(
    `${ADMIN_JOURNAL_VERIFICATION_CLE_PREFIXE}${adminId}`,
    ADMIN_JOURNAL_VERIFICATION_LIMIT.limit,
    ADMIN_JOURNAL_VERIFICATION_LIMIT.windowS,
    { failClosed: true },
  )
  return verifierChaine(db)
}
