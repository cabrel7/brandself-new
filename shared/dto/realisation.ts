import type { LimitePlanDTO } from './abonnement'
import type { MediaDTO, SeoPublicDTO } from './media'

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
  /** S10 : actif mais au-delà de la limite du plan, donc absent de la vitrine (« Masqué sur la vitrine »). */
  masqueParPlan: boolean
  ordre: number
  creeLe: string
  modifieLe: string
}

export interface RealisationsCompteursDTO {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
  limitePlan: LimitePlanDTO
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
  seo: SeoPublicDTO
  /** ISO 8601 : `lastmod` et `og:updated_time`. */
  modifieLe: string
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
