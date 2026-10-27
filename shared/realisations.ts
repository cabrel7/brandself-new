// Listes recopiées dans les CHECK de la migration 0011 : les garder synchronisées.
export const REALISATION_TITRE_MAX = 100
export const REALISATION_DESCRIPTION_MAX = 2000
export const REALISATION_LIEU_MAX = 100
export const REALISATION_ROLE_MAX = 100
export const REALISATION_LIEN_MAX = 500
export const ANNEE_MIN = 1900
export const ANNEE_MAX = 2100
export const GALERIE_MAX = 6
export const REALISATION_SLUG_REPLI = 'realisation'
export const AUTRES_REALISATIONS_MAX = 2

/** Libellés des faits affichés sur le détail public. */
export const REALISATION_FAITS_LIBELLES = {
  annee: 'Année',
  lieu: 'Lieu',
  role: 'Rôle',
} as const

const SEPARATEUR_META = ' · '
const SUFFIXE_MASQUE = 'Masqué'
const SURTITRE = 'Réalisation'
const SCHEMA_PAR_DEFAUT = 'https://'
const REGEX_SCHEMA = /^[a-z][a-z0-9+.-]*:/i

/**
 * Prépare la saisie d'un lien : rogne, '' -> null, préfixe `https://` si aucun schéma.
 * Toute valeur qui n'est pas une chaîne est renvoyée telle quelle (Zod la rejettera).
 */
export function normaliserLien(valeur: unknown): unknown {
  if (typeof valeur !== 'string') return valeur
  const rogne = valeur.trim()
  if (rogne === '') return null
  return REGEX_SCHEMA.test(rogne) ? rogne : `${SCHEMA_PAR_DEFAUT}${rogne}`
}

export interface RealisationMetaSource {
  annee: number | null
  lieu: string | null
}

/** `'2025 · Douala'` | `'2025'` | `'Douala'` | `''`. */
export function metaRealisation(r: RealisationMetaSource): string {
  const parts: string[] = []
  if (r.annee !== null) parts.push(String(r.annee))
  if (r.lieu !== null && r.lieu !== '') parts.push(r.lieu)
  return parts.join(SEPARATEUR_META)
}

export interface RealisationMetaStudioSource extends RealisationMetaSource {
  actif: boolean
}

/** Méta de la liste studio, suffixée de `· Masqué` (`'Masqué'` seul sans méta). */
export function metaRealisationStudio(r: RealisationMetaStudioSource): string {
  const meta = metaRealisation(r)
  if (r.actif) return meta
  return meta === '' ? SUFFIXE_MASQUE : `${meta}${SEPARATEUR_META}${SUFFIXE_MASQUE}`
}

/** `'Réalisation · 2025'` | `'Réalisation'`. */
export function surtitreRealisation(annee: number | null): string {
  return annee === null ? SURTITRE : `${SURTITRE}${SEPARATEUR_META}${annee}`
}

/** `'4 visibles · 2 en vedette sur 3'` (`'1 visible'`, `'0 visible'`). */
export function resumeListeRealisations(visibles: number, enVedette: number, max: number): string {
  const libelleVisibles = visibles > 1 ? `${visibles} visibles` : `${visibles} visible`
  return `${libelleVisibles}${SEPARATEUR_META}${enVedette} en vedette sur ${max}`
}

/** `'2 réalisations sur 3 en vedette.'` (`'0 réalisation'`, `'1 réalisation'`). */
export function libelleVedetteRealisations(n: number, max: number): string {
  const nom = n > 1 ? 'réalisations' : 'réalisation'
  return `${n} ${nom} sur ${max} en vedette.`
}

export function realisationsHref(username: string): string {
  return `/${username}/realisations`
}

export function realisationDetailHref(username: string, slug: string): string {
  return `/${username}/realisations/${slug}`
}

/** Année en cours (isolée pour être testable). */
export function anneeCourante(): number {
  return new Date().getFullYear()
}
