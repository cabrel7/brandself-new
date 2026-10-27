// Aides SEO communes aux ressources publiques (services, réalisations, témoignages).
// Extraites de resources/service.ts par la factorisation S4 (décision #58).

export const SEO_DESCRIPTION_MAX = 160
const ELLIPSE = '…'

/** Texte sur une ligne, coupé sur une limite de mot à 160 caractères au plus (ellipse comprise). */
export function truncateForSeo(texte: string): string {
  if (texte.length <= SEO_DESCRIPTION_MAX) return texte
  const limite = SEO_DESCRIPTION_MAX - ELLIPSE.length
  let coupe = texte.slice(0, limite)
  if (!/\s/.test(texte.charAt(limite))) {
    const dernierEspace = coupe.search(/\s\S*$/)
    if (dernierEspace > 0) coupe = coupe.slice(0, dernierEspace)
  }
  return `${coupe.trimEnd()}${ELLIPSE}`
}
