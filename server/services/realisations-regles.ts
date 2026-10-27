import { LISTE_SLUG_MAX } from '../../shared/listes'
import { REALISATION_SLUG_REPLI } from '../../shared/realisations'
import { slugFromText } from './listes-regles'

// Règles pures des réalisations (aucune base, aucun réseau) : testées par
// tests/unit/realisations-regles.test.ts et slug-realisation.test.ts.

/** Partie de l'état d'une réalisation concernée par les règles de cohérence (R2, R4, R5, R8). */
export interface RealisationState {
  imageMediaId: string | null
  /** Identifiants de médias, dans l'ordre d'affichage. */
  galerie: string[]
  actif: boolean
  enVedette: boolean
}

const MSG_GALERIE_PRINCIPALE = 'Cette image est déjà l’image principale.'
const MSG_VEDETTE_MASQUEE = 'Une réalisation masquée ne peut pas être en vedette.'

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

/**
 * Fusionne le patch sur l'état (les `undefined` sont ignorés) puis applique R4 : masquer sans
 * demande de vedette explicite retire la vedette. `galerie` fournie remplace toute la galerie.
 * Renvoie un nouvel objet ; les entrées ne sont jamais modifiées.
 */
export function normalizeRealisationState<E extends RealisationState>(etat: E, patch: Partial<E>): E {
  const merged: E = { ...etat, ...omitUndefined(patch) }
  merged.galerie = [...merged.galerie]
  if (patch.actif === false && patch.enVedette === undefined) {
    merged.enVedette = false
  }
  return merged
}

/** Erreurs de cohérence par champ (R2 et R5) ; objet vide si l'état est cohérent. */
export function checkRealisationCoherence(etat: RealisationState): Record<string, string[]> {
  const erreurs: Record<string, string[]> = {}
  if (etat.imageMediaId !== null && etat.galerie.includes(etat.imageMediaId)) {
    erreurs.galerie = [MSG_GALERIE_PRINCIPALE]
  }
  if (!etat.actif && etat.enVedette) {
    erreurs.enVedette = [MSG_VEDETTE_MASQUEE]
  }
  return erreurs
}

/** Slug d'un titre de réalisation : 80 caractères au plus, sans tiret final, repli `realisation`. */
export function slugFromTitreRealisation(titre: string): string {
  return slugFromText(titre, { max: LISTE_SLUG_MAX, repli: REALISATION_SLUG_REPLI })
}

/** Médias de `avant` (image et galerie) qui ne figurent plus dans `apres` : sans doublon, sans null (R8). */
export function mediasARetirer(
  avant: Pick<RealisationState, 'imageMediaId' | 'galerie'>,
  apres: Pick<RealisationState, 'imageMediaId' | 'galerie'>,
): string[] {
  const conserves = new Set<string>(apres.galerie)
  if (apres.imageMediaId !== null) conserves.add(apres.imageMediaId)
  const anciens = new Set<string>(avant.galerie)
  if (avant.imageMediaId !== null) anciens.add(avant.imageMediaId)
  return [...anciens].filter((id) => !conserves.has(id))
}
