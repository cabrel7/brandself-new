// A4 (UI) : fonctions pures de la page des réglages. Les bornes et la validation croisée viennent du registre partagé
// (`shared/reglages.ts`) : le serveur reste la seule autorité, ceci évite seulement un aller-retour inutile.
import { REGLAGES, REGLAGE_CATEGORIES, REGLAGE_CATEGORIE_LIBELLES } from '#shared/reglages'
import type { LireReglage, ReglageCategorie, ReglageDefinition, ReglageValeur } from '#shared/reglages'
import type { ReglageDto } from '#shared/schemas/admin-a4'

type ValeurQuery = string | null | Array<string | null> | undefined

export const CATEGORIE_REGLAGE_PAR_DEFAUT: ReglageCategorie = REGLAGE_CATEGORIES[0]

export const LIBELLE_REGLAGE_VIDE = 'Aucun message'

/** Catégorie lue dans l'URL ; une valeur inconnue retombe sur la première (jamais une page vide). */
export function lireCategorieReglage(valeur: ValeurQuery): ReglageCategorie {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur
  return REGLAGE_CATEGORIES.find((categorie) => categorie === brut) ?? CATEGORIE_REGLAGE_PAR_DEFAUT
}

export function optionsCategoriesReglage(): Array<{ label: string, value: ReglageCategorie }> {
  return REGLAGE_CATEGORIES.map((categorie) => ({ label: REGLAGE_CATEGORIE_LIBELLES[categorie], value: categorie }))
}

export function reglagesDeCategorie(elements: readonly ReglageDto[], categorie: ReglageCategorie): ReglageDto[] {
  return elements.filter((reglage) => reglage.categorie === categorie)
}

/** Valeur lisible : « Activé », « 10 », le texte, ou « Aucun message ». */
export function libelleValeurReglage(valeur: ReglageValeur): string {
  if (typeof valeur === 'boolean') return valeur ? 'Activé' : 'Désactivé'
  if (typeof valeur === 'string') return valeur.trim() === '' ? LIBELLE_REGLAGE_VIDE : valeur
  return String(valeur)
}

/**
 * Valeur de repli quand la base est illisible : la valeur RESTRICTIVE pour un drapeau de sécurité (D-A4-06), sinon la
 * valeur du code.
 */
export function valeurRepliReglage(reglage: ReglageDto): ReglageValeur {
  const definition: ReglageDefinition = REGLAGES[reglage.cle]
  return definition.type === 'booleen' && definition.securite ? definition.repliFerme : reglage.defaut
}

export function estModifieReglage(reglage: ReglageDto, brouillon: ReglageValeur | null): boolean {
  return brouillon !== reglage.valeur
}

/** « Rétablir le défaut » n'a de sens que si une ligne de la table fixe la valeur et que le réglage est modifiable. */
export function peutRetablirReglage(reglage: ReglageDto): boolean {
  return reglage.modifiable && reglage.surcharge
}

function messageBornes(reglage: ReglageDto): string {
  return `Saisissez un nombre entier de ${reglage.min ?? 0} à ${reglage.max ?? 0}.`
}

/** Message sous le champ, ou chaîne vide si la saisie est acceptable. `tous` sert à la validation croisée du registre. */
export function erreurSaisieReglage(
  reglage: ReglageDto,
  brouillon: ReglageValeur | null,
  tous: readonly ReglageDto[],
): string {
  if (reglage.type === 'entier') {
    if (typeof brouillon !== 'number' || !Number.isInteger(brouillon)) return messageBornes(reglage)
    if (reglage.min !== null && brouillon < reglage.min) return messageBornes(reglage)
    if (reglage.max !== null && brouillon > reglage.max) return messageBornes(reglage)
  }
  if (reglage.type === 'texte' && typeof brouillon === 'string' && reglage.longueurMax !== null && brouillon.length > reglage.longueurMax) {
    return `Le message ne peut pas dépasser ${reglage.longueurMax} caractères.`
  }
  if (brouillon === null) return messageBornes(reglage)
  const definition: ReglageDefinition = REGLAGES[reglage.cle]
  const lire: LireReglage = (cle) => tous.find((autre) => autre.cle === cle)?.valeur ?? REGLAGES[cle].defaut
  return definition.valider?.(brouillon, lire) ?? ''
}

/** Corps de `PUT /api/admin/reglages/[cle]` : `valeur` `null` rétablit le défaut (schéma strict, aucune clé en trop). */
export function corpsModificationReglage(
  valeur: ReglageValeur | null,
  motif: string,
  cleIdempotence: string,
): { valeur: ReglageValeur | null, motif: string, cleIdempotence: string } {
  const propre = typeof valeur === 'string' ? valeur.trim() : valeur
  return { valeur: propre, motif: motif.trim(), cleIdempotence }
}
