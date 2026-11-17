// A3 (D-A3-09) : export CSV des paiements. Données personnelles (e-mail du titulaire) : l'export est JOURNALISÉ
// (`export.paiements`, sans contenu, dans la même transaction que la lecture), plafonné (422 `EXPORT_TROP_GRAND`) et
// neutralise l'injection de formules (cellule commençant par `= + - @ tabulation retour-chariot`).
import { desc, eq, and } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import {
  EXPORT_CARACTERES_FORMULE,
  EXPORT_NEUTRALISATION,
  EXPORT_PAIEMENTS_COLONNES,
} from '../../../shared/admin-paiements'
import type { ExportPaiementsColonne } from '../../../shared/admin-paiements'
import { paiements, users } from '../../../shared/db/schema'
import { ADMIN_EXPORT_LIGNES_MAX } from '../../../shared/limites'
import type { ExportPaiements } from '../../../shared/schemas/admin-paiements'
import { UnprocessableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { enregistrer } from './audit'
import { COLONNES_PAIEMENT_ADMIN, conditionsFiltresPaiements, versPaiementAdmin } from './paiements'
import type { PaiementAdmin } from './paiements'
import type { ActeurAdmin } from './paiements-journal'

export interface ResultatExport {
  lignes: PaiementAdmin[]
}

/** Préfixe une apostrophe à toute cellule que le tableur lirait comme une formule. */
export function neutraliserCellule(valeur: string): string {
  return valeur !== '' && EXPORT_CARACTERES_FORMULE.includes(valeur.charAt(0)) ? `${EXPORT_NEUTRALISATION}${valeur}` : valeur
}

const CSV_SEPARATEUR = ','
const CSV_FIN_DE_LIGNE = '\r\n'
const CSV_GUILLEMET = '"'
const CSV_A_ECHAPPER = /[",\r\n]/

/** Cellule CSV (RFC 4180) : neutralisée d'abord, puis entourée de guillemets si elle contient séparateur, guillemet ou saut de ligne. */
export function celluleCsv(valeur: string): string {
  const neutre = neutraliserCellule(valeur)
  return CSV_A_ECHAPPER.test(neutre)
    ? `${CSV_GUILLEMET}${neutre.replaceAll(CSV_GUILLEMET, CSV_GUILLEMET + CSV_GUILLEMET)}${CSV_GUILLEMET}`
    : neutre
}

function texte(valeur: string | number | Date | null): string {
  if (valeur === null) return ''
  return valeur instanceof Date ? valeur.toISOString() : String(valeur)
}

/** Valeur de chaque colonne exportée, dans l'ordre de `EXPORT_PAIEMENTS_COLONNES`. Aucun téléphone, aucun numéro. */
function valeurColonne(paiement: PaiementAdmin, colonne: ExportPaiementsColonne): string {
  switch (colonne) {
    case 'id': return paiement.id
    case 'reference': return paiement.referenceFournisseur ?? paiement.id
    case 'statut': return paiement.statut
    case 'source': return paiement.source
    case 'methode': return paiement.methode
    case 'operateur': return texte(paiement.operateur)
    case 'plan': return paiement.plan
    case 'periodeMois': return texte(paiement.periodeMois)
    case 'devise': return paiement.devise
    case 'montant': return texte(paiement.montant)
    case 'fraisReels': return texte(paiement.fraisReels)
    case 'netReel': return texte(paiement.netReel)
    case 'codeEchec': return texte(paiement.codeEchec)
    case 'creeLe': return texte(paiement.creeLe)
    case 'appliqueLe': return texte(paiement.appliqueLe)
    case 'emailTitulaire': return paiement.utilisateur?.email ?? ''
  }
}

/** Fichier CSV complet : en-tête puis une ligne par paiement. */
export function construireCsv(lignes: readonly PaiementAdmin[]): string {
  const entete = EXPORT_PAIEMENTS_COLONNES.join(CSV_SEPARATEUR)
  const corps = lignes.map((paiement) =>
    EXPORT_PAIEMENTS_COLONNES.map((colonne) => celluleCsv(valeurColonne(paiement, colonne))).join(CSV_SEPARATEUR))
  return [entete, ...corps].join(CSV_FIN_DE_LIGNE) + CSV_FIN_DE_LIGNE
}

/**
 * Lit les paiements filtrés (au plus `ADMIN_EXPORT_LIGNES_MAX`) et journalise l'export dans la MÊME transaction : pas
 * d'export sans trace. La lecture demande une ligne de plus que le plafond : un dépassement est détecté sans `count`.
 * Le journal ne contient que le nombre de lignes et les filtres d'énumération (jamais les dates, jamais un contenu).
 */
export async function exporterPaiements(acteur: ActeurAdmin, entree: ExportPaiements): Promise<ResultatExport> {
  return db.transaction(async (tx) => {
    const lues = await tx
      .select(COLONNES_PAIEMENT_ADMIN)
      .from(paiements)
      .leftJoin(users, eq(users.id, paiements.userId))
      .where(and(...conditionsFiltresPaiements(entree.filtres)))
      .orderBy(desc(paiements.createdAt), desc(paiements.id))
      .limit(ADMIN_EXPORT_LIGNES_MAX + 1)
    if (lues.length > ADMIN_EXPORT_LIGNES_MAX) throw new UnprocessableError('EXPORT_TROP_GRAND')
    const { statut, source, devise } = entree.filtres
    await enregistrer(tx, {
      adminId: acteur.adminId,
      action: ADMIN_ACTIONS.exportPaiements,
      cibleType: ADMIN_CIBLES.export,
      cibleId: null,
      avant: null,
      apres: { lignes: lues.length, ...(statut ? { statut } : {}), ...(source ? { source } : {}), ...(devise ? { devise } : {}) },
      motif: entree.motif,
      ip: acteur.ip,
    })
    return { lignes: lues.map(versPaiementAdmin) }
  })
}
