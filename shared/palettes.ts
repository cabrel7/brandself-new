export const PALETTES = ['terracotta', 'sauge', 'indigo', 'ocre', 'bordeaux'] as const

export type Palette = (typeof PALETTES)[number]

export const DEFAULT_PALETTE: Palette = 'terracotta'

export const PALETTE_LABELS: Record<Palette, string> = {
  terracotta: 'Terracotta',
  sauge: 'Sauge',
  indigo: 'Indigo',
  ocre: 'Ocre',
  bordeaux: 'Bordeaux',
}
