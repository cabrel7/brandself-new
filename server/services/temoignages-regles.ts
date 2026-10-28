import { LISTE_SLUG_MAX } from '../../shared/listes'
import { slugFromText } from './listes-regles'

// Règles pures des témoignages (aucune base, aucun réseau) : testées par
// tests/unit/temoignages-regles.test.ts.

const MSG_VEDETTE_MASQUEE = 'Un témoignage masqué ne peut pas être en vedette.'

export interface TemoignageState {
  actif: boolean
  enVedette: boolean
}

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

/** Fusionne le patch sur l'état (les `undefined` sont ignorés) puis applique R4 : masquer sans
 * demande de vedette explicite retire la vedette. Renvoie un nouvel objet ; les entrées ne sont jamais modifiées. */
export function normalizeTemoignageState<E extends TemoignageState>(etat: E, patch: Partial<E>): E {
  const merged: E = { ...etat, ...omitUndefined(patch) }
  if (patch.actif === false && patch.enVedette === undefined) {
    merged.enVedette = false
  }
  return merged
}

/** Erreurs de cohérence par champ (R4) ; objet vide si l'état est cohérent. */
export function checkTemoignageCoherence(etat: TemoignageState): Record<string, string[]> {
  const erreurs: Record<string, string[]> = {}
  if (!etat.actif && etat.enVedette) {
    erreurs.enVedette = [MSG_VEDETTE_MASQUEE]
  }
  return erreurs
}

/** Slug d'un auteur de témoignage : 80 caractères au plus, sans tiret final, repli `temoignage`. */
export function slugFromAuteurTemoignage(auteur: string): string {
  return slugFromText(auteur, { max: LISTE_SLUG_MAX, repli: 'temoignage' })
}
