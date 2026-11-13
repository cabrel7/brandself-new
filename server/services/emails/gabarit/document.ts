import type { Palette } from '../../../../shared/palettes'

// Modèle unique d'un e-mail : deux rendus purs (texte, HTML) en sont tirés.

export type IdentiteEmail =
  | { type: 'plateforme' }
  | { type: 'professionnel', nom: string, metier: string, palette: Palette, vitrineUrl: string }

export interface LigneRecapitulatif {
  libelle: string
  valeur: string
}

export type ElementEmail =
  /** HTML seul : le texte actuel n'a pas de titre. */
  | { type: 'titre', texte: string }
  | { type: 'paragraphe', texte: string }
  /** Texte saisi par un visiteur : verbatim dans le texte, lignes échappées jointes par <br> en HTML, jamais de lien. */
  | { type: 'texteSaisi', texte: string }
  | { type: 'code', libelle: string, code: string }
  | { type: 'recapitulatif', lignes: readonly LigneRecapitulatif[] }
  | { type: 'liste', lignes: readonly string[] }
  /** `url` doit figurer dans `lignesTexte`. */
  | { type: 'bouton', libelle: string, url: string, lignesTexte: readonly string[] }
  /** Si `url`, elle doit figurer dans `lignesTexte ?? [texte]`. */
  | { type: 'encadre', texte: string, url?: string, lignesTexte?: readonly string[] }

export interface LignePied {
  texte: string
  /** Si présente, doit figurer dans `texte`. */
  url?: string
}

export interface DocumentEmail {
  objet: string
  preheader: string
  /** Origine du site (paramètre : le gabarit ne lit ni runtimeConfig ni environnement). */
  siteUrl: string
  identite: IdentiteEmail
  salutation: string
  elements: readonly ElementEmail[]
  cloture: string | null
  pied: readonly LignePied[] | null
}

export interface EmailRendu {
  subject: string
  text: string
  html: string
}
