import type { MediaDTO } from './media'

export interface RealisationStudioDTO {
  id: string
  slug: string
  titre: string
  description: string | null
  image: MediaDTO | null
  /** Dans l'ordre d'affichage. */
  galerie: MediaDTO[]
  annee: number | null
  lieu: string | null
  role: string | null
  lien: string | null
  enVedette: boolean
  actif: boolean
  ordre: number
  creeLe: string
  modifieLe: string
}

export interface RealisationsCompteursDTO {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

/** Liste blanche publique : jamais id, vitrineId, ordre, actif, enVedette, dates. */
export interface RealisationPublicCarteDTO {
  slug: string
  titre: string
  description: string | null
  image: MediaDTO | null
  annee: number | null
  lieu: string | null
}

export interface RealisationPublicDetailDTO extends RealisationPublicCarteDTO {
  role: string | null
  lien: string | null
  galerie: MediaDTO[]
  seo: { titre: string, description: string }
}

export interface RealisationsStudioReponse {
  realisations: RealisationStudioDTO[]
  compteurs: RealisationsCompteursDTO
}

export interface RealisationStudioReponse {
  realisation: RealisationStudioDTO
  compteurs: RealisationsCompteursDTO
}

export interface RealisationsPublicsReponse {
  total: number
  aLaUne: RealisationPublicCarteDTO[]
  realisations: RealisationPublicCarteDTO[]
}

export interface RealisationPublicReponse {
  realisation: RealisationPublicDetailDTO
  autres: RealisationPublicCarteDTO[]
  total: number
}
