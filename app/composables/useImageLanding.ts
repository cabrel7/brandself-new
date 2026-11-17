import { IMAGES } from '~/data/landing'

/** Clé d'une image de démonstration de la page d'accueil (voir `IMAGES`). */
export type CleImageLanding = keyof typeof IMAGES

export interface ImageLanding {
  src: string
  alt: string
  width: number
  height: number
}

// Dimensions intrinsèques des fichiers de `public/landing/` : elles réservent la place avant le chargement (pas de décalage de mise en page).
const DIMENSIONS: Record<CleImageLanding, { width: number, height: number }> = {
  medecin: { width: 1000, height: 738 },
  medecine: { width: 1000, height: 1049 },
  avocat: { width: 1000, height: 1256 },
  coach: { width: 1000, height: 1500 },
  photographe: { width: 1000, height: 1450 },
  stethoscope: { width: 1000, height: 667 },
  vitrinePc: { width: 1800, height: 3304 },
  google: { width: 272, height: 92 },
}

/**
 * Image de démonstration avec ses dimensions déclarées. `largeur` (en pixels) demande une version réduite
 * du même rapport (jamais agrandie) : l'optimiseur d'images en sert exactement la taille utile.
 */
export function useImageLanding(cle: CleImageLanding, largeur?: number): ImageLanding {
  const { width, height } = DIMENSIONS[cle]
  const cible = Math.min(largeur ?? width, width)
  return { ...IMAGES[cle], width: cible, height: Math.round((cible * height) / width) }
}
