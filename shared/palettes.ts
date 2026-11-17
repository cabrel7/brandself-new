export const PALETTES = ['terracotta', 'sauge', 'indigo', 'ocre', 'bordeaux'] as const

export type Palette = (typeof PALETTES)[number]

export const DEFAULT_PALETTE: Palette = 'terracotta'

/** Rétrécit un texte libre (colonne `vitrines.palette`) en palette connue, repli terracotta. */
export function asPalette(value: string): Palette {
  return PALETTES.find((palette) => palette === value) ?? DEFAULT_PALETTE
}

export const PALETTE_LABELS: Record<Palette, string> = {
  terracotta: 'Terracotta',
  sauge: 'Sauge',
  indigo: 'Indigo',
  ocre: 'Ocre',
  bordeaux: 'Bordeaux',
}
