// Constantes et textes des témoignages, partagés entre le studio et le reste de l'app.
// Les maxima sont recopiés dans les schémas Zod (`shared/schemas/temoignage.ts`) : garder synchronisés.

export const TEMOINAGE_AUTEUR_MAX = 100
export const TEMOINAGE_FONCTION_MAX = 100
export const TEMOINAGE_TEXTE_MAX = 1000
/** Repli de slug côté client, aligné sur `slugFromAuteurTemoignage` (serveur). */
export const TEMOINAGE_SLUG_REPLI = 'temoignage'

const SEPARATEUR_META = ' · '
const SUFFIXE_MASQUE = 'Masqué'
const EXTRAIT_MAX = 80

export interface TemoignageMetaStudioSource {
  fonction: string | null
  texte: string
  actif: boolean
}

/** Extrait du texte (une ligne) : rogné sur un mot, `…` si tronqué. */
function extraitTexte(texte: string): string {
  const propre = texte.trim()
  if (propre.length <= EXTRAIT_MAX) return propre
  const rogne = propre.slice(0, EXTRAIT_MAX)
  const dernierEspace = rogne.lastIndexOf(' ')
  return `${(dernierEspace > EXTRAIT_MAX / 2 ? rogne.slice(0, dernierEspace) : rogne).trimEnd()}…`
}

/** Méta de la liste studio : la fonction si présente, sinon un extrait du texte ; suffixée de `· Masqué` si masqué. */
export function metaTemoignageStudio(t: TemoignageMetaStudioSource): string {
  const fonction = t.fonction?.trim() ?? ''
  const meta = fonction === '' ? extraitTexte(t.texte) : fonction
  if (t.actif) return meta
  return meta === '' ? SUFFIXE_MASQUE : `${meta}${SEPARATEUR_META}${SUFFIXE_MASQUE}`
}

/** `'4 visibles · 2 en vedette sur 3'` (`'1 visible'`, `'0 visible'`). */
export function resumeListeTemoignages(visibles: number, enVedette: number, max: number): string {
  const libelleVisibles = visibles > 1 ? `${visibles} visibles` : `${visibles} visible`
  return `${libelleVisibles}${SEPARATEUR_META}${enVedette} en vedette sur ${max}`
}

/** `'2 témoignages sur 3 en vedette.'` (`'0 témoignage'`, `'1 témoignage'`). */
export function libelleVedetteTemoignages(n: number, max: number): string {
  const nom = n > 1 ? 'témoignages' : 'témoignage'
  return `${n} ${nom} sur ${max} en vedette.`
}
