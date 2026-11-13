import type { Palette } from '../../../../shared/palettes'

// SEULE source de couleurs hexadécimales des e-mails (exception à CLAUDE.md §5 : un client de messagerie ne lit
// pas les variables CSS). Valeurs égales à app/assets/css/main.css, vérifiées par tests/unit/emails-jetons.test.ts.

export interface JetonsPalette {
  fond: string
  surface: string
  encre: string
  texteSecondaire: string
  accent: string
  accentDoux: string
  bordure: string
  erreur: string
  champ: string
  surAccent: string
}

const COMMUNS = { erreur: '#B3261E', champ: '#FFFFFF', surAccent: '#FFFFFF' } as const

export const JETONS_PALETTES: Readonly<Record<Palette, JetonsPalette>> = {
  terracotta: { fond: '#FBF7F0', surface: '#F3EBDD', encre: '#231F1C', texteSecondaire: '#6B5F55', accent: '#B4532F', accentDoux: '#F2DDD2', bordure: '#E6DCCB', ...COMMUNS },
  sauge: { fond: '#F8F7F1', surface: '#ECEFE3', encre: '#1F2420', texteSecondaire: '#5C6358', accent: '#3F6B4F', accentDoux: '#DDE8DC', bordure: '#DCE0D0', ...COMMUNS },
  indigo: { fond: '#F7F5F1', surface: '#E9E7EF', encre: '#1E1B2E', texteSecondaire: '#5A5670', accent: '#3B3F8C', accentDoux: '#DDDFF2', bordure: '#DEDBE6', ...COMMUNS },
  ocre: { fond: '#FCF8EE', surface: '#F6EBCB', encre: '#26200F', texteSecondaire: '#6A5E3F', accent: '#946409', accentDoux: '#F6E3B0', bordure: '#EADFBE', ...COMMUNS },
  bordeaux: { fond: '#FAF5F3', surface: '#F1E4E1', encre: '#2A1C1E', texteSecondaire: '#6B5558', accent: '#8A2F45', accentDoux: '#F0D8DD', bordure: '#E8D5D3', ...COMMUNS },
}

export const MARQUE_EMAIL = {
  /** Couleur du point du logotype « jesuis.pro ». */
  point: '#C1512A',
} as const

/** Piles de polices : aucune police web (aucune ressource distante). */
export const POLICES = {
  titre: "Georgia, 'Times New Roman', Times, serif",
  texte: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  code: "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace",
} as const

/** Tailles en pixels. */
export const TAILLES = {
  petit: 13,
  corps: 16,
  logo: 24,
  titre: 24,
  code: 32,
  boutonHauteur: 48,
} as const

export const LARGEUR_EMAIL = 600
