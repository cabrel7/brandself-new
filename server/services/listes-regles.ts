import slugify from '@sindresorhus/slugify'
import { LISTE_SLUG_REGEX } from '../../shared/listes'

// Règles pures communes aux listes d'une vitrine (services, réalisations, témoignages) : aucune base,
// aucun réseau. Extraites de services-regles.ts par la factorisation S4 (décision #58) ; testées par
// tests/unit/listes-regles.test.ts.

const SLUG_SEPARATEUR = '-'
const SLUG_SUFFIXE_MIN = 2
const TRAILING_DASHES = /-+$/

export interface ResolveEnVedetteInput {
  /** `undefined` = automatique. */
  demande: boolean | undefined
  actif: boolean
  autresEnVedette: number
  max: number
}

/** Décide la vedette d'un élément ; `'COMPLET'` si une vedette explicite dépasse le plafond. */
export function resolveEnVedette({ demande, actif, autresEnVedette, max }: ResolveEnVedetteInput): boolean | 'COMPLET' {
  const place = autresEnVedette < max
  if (demande === false) return false
  if (demande === true) return place ? true : 'COMPLET'
  return actif && place
}

/** Les vedettes visibles, sinon les `max` premiers visibles. Jamais plus de `max`. Mêmes objets. */
export function computeALaUne<T extends { enVedette: boolean }>(visibles: readonly T[], max: number): T[] {
  const vedettes = visibles.filter((ligne) => ligne.enVedette)
  return (vedettes.length > 0 ? vedettes : visibles).slice(0, max)
}

export interface Compteurs {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

export function computeCompteurs(lignes: readonly { actif: boolean, enVedette: boolean }[], max: number): Compteurs {
  return {
    total: lignes.length,
    visibles: lignes.filter((ligne) => ligne.actif).length,
    enVedette: lignes.filter((ligne) => ligne.enVedette).length,
    vedetteMax: max,
  }
}

function cutSlug(slug: string, max: number): string {
  return slug.slice(0, max).replace(TRAILING_DASHES, '')
}

export interface SlugOptions {
  max: number
  repli: string
}

/** Slug d'un texte : accents et ligatures translittérés, « & » -> « et », `max` caractères au plus, `repli` sinon. */
export function slugFromText(texte: string, { max, repli }: SlugOptions): string {
  const slug = cutSlug(slugify(texte, { customReplacements: [['&', ' et ']], decamelize: false }), max)
  return LISTE_SLUG_REGEX.test(slug) ? slug : repli
}

/** `base`, sinon `base-2`, `base-3`… (premier numéro libre), toujours dans la limite de `max` caractères. */
export function pickAvailableSlug(base: string, existants: ReadonlySet<string>, max: number): string {
  if (!existants.has(base)) return base
  for (let numero = SLUG_SUFFIXE_MIN; ; numero += 1) {
    const suffixe = `${SLUG_SEPARATEUR}${numero}`
    const candidat = `${cutSlug(base, max - suffixe.length)}${suffixe}`
    if (!existants.has(candidat)) return candidat
  }
}
