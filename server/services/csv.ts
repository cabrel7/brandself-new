// A4 : briques CSV communes (RFC 4180) avec neutralisation de l'injection de formules (OWASP) : toute cellule qui
// commence par `= + - @`, une tabulation ou un retour chariot reçoit une apostrophe en préfixe (CA13).
import { EXPORT_CARACTERES_FORMULE, EXPORT_NEUTRALISATION } from '../../shared/admin-paiements'

const CSV_SEPARATEUR = ','
export const CSV_FIN_DE_LIGNE = '\r\n'
const CSV_GUILLEMET = '"'
const CSV_A_ECHAPPER = /[",\r\n]/

export function neutraliserCellule(valeur: string): string {
  return valeur !== '' && EXPORT_CARACTERES_FORMULE.includes(valeur.charAt(0)) ? `${EXPORT_NEUTRALISATION}${valeur}` : valeur
}

/** Cellule : neutralisée d'abord, puis entourée de guillemets si elle contient séparateur, guillemet ou saut de ligne. */
export function celluleCsv(valeur: string): string {
  const neutre = neutraliserCellule(valeur)
  return CSV_A_ECHAPPER.test(neutre)
    ? `${CSV_GUILLEMET}${neutre.replaceAll(CSV_GUILLEMET, CSV_GUILLEMET + CSV_GUILLEMET)}${CSV_GUILLEMET}`
    : neutre
}

/** Une ligne CSV (sans fin de ligne) : chaque cellule est neutralisée et échappée. */
export function cellulesCsv(cellules: readonly string[]): string {
  return cellules.map(celluleCsv).join(CSV_SEPARATEUR)
}

/** Fichier CSV complet : l'en-tête (constante, non neutralisée) puis une ligne par enregistrement. */
export function construireCsv(entete: readonly string[], lignes: readonly (readonly string[])[]): string {
  return [entete.join(CSV_SEPARATEUR), ...lignes.map(cellulesCsv)].join(CSV_FIN_DE_LIGNE) + CSV_FIN_DE_LIGNE
}
