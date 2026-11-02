import type { LienType } from '../liens'

export interface LienStudioDTO {
  id: string
  slug: string
  libelle: string
  url: string
  type: LienType
  /** Renseigné pour les liens `reseau` : choisit l'icône du pied de vitrine. */
  plateforme: string | null
  actif: boolean
  ordre: number
  clics: number
  clicsSemaine: number
  creeLe: string
  modifieLe: string
}

/** Compteurs de la liste studio : « 4 liens · 3 visibles », « 42 clics cette semaine ». */
export interface LiensCompteursDTO {
  total: number
  visibles: number
  clicsSemaine: number
}

/** Liste blanche publique : jamais id interne, vitrineId, ordre, actif, dates. */
export interface LienPublicCarteDTO {
  slug: string
  libelle: string
  url: string
  type: LienType
  /** Renseigné pour les liens de type `reseau` : choisit l'icône du pied de vitrine. */
  plateforme: string | null
}

export interface LiensStudioReponse {
  liens: LienStudioDTO[]
  compteurs: LiensCompteursDTO
}

export interface LienStudioReponse {
  lien: LienStudioDTO
}

export interface LiensPublicsReponse {
  total: number
  liens: LienPublicCarteDTO[]
}
