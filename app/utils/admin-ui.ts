// Administration : réglages d'interface communs (zones tactiles >= 44 px, compteur de filtres). Fonctions et constantes
// pures. `--cible-tactile` vaut 2.75rem (44 px) : jamais de taille codée en dur.
const CIBLE = 'min-h-(--cible-tactile)'
const CIBLE_CARREE = 'min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center'

/** Champ (UInput, USelect) : hauteur tactile. */
export const UI_CHAMP_TACTILE = { base: CIBLE }

/** UPagination : chaque bouton (premier, précédent, pages, suivant, dernier) fait au moins 44 x 44 px. */
export const UI_PAGINATION_TACTILE = {
  first: CIBLE_CARREE,
  prev: CIBLE_CARREE,
  item: CIBLE_CARREE,
  next: CIBLE_CARREE,
  last: CIBLE_CARREE,
}

/** UTabs : onglets de 44 px de haut, qui se partagent la largeur. */
export const UI_ONGLETS_TACTILES = { trigger: `${CIBLE} grow justify-center` }

/** Classe d'un bouton icône seul. */
export const CLASSE_BOUTON_ICONE = CIBLE_CARREE

/** Nombre de filtres actifs, hors recherche et tri (qui restent visibles hors du bloc repliable). */
export function compterFiltresActifs(filtres: Record<string, string | undefined>, exclus: readonly string[]): number {
  return Object.entries(filtres).filter(([nom, valeur]) => valeur !== undefined && !exclus.includes(nom)).length
}
