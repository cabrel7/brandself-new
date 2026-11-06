import type { Devise } from '../compte'
import type { PaiementMode, Rythme, ServiceType, Tarif } from '../services'
import type { LimitePlanDTO } from './abonnement'
import type { MediaDTO, SeoPublicDTO } from './media'

/** Montants (`prixMontant`) en unité mineure de la devise (cf. shared/devises.ts). */
export interface ServiceStudioDTO {
  id: string
  slug: string
  titre: string
  description: string | null
  image: MediaDTO | null
  type: ServiceType
  nbSeances: number | null
  rythme: Rythme | null
  dureeMin: number | null
  tarif: Tarif
  prixMontant: number | null
  prixDevise: Devise | null
  paiementMode: PaiementMode | null
  paiementInstructions: string | null
  inclus: string[]
  reservable: boolean
  enVedette: boolean
  actif: boolean
  /** S10 : actif mais au-delà de la limite du plan, donc absent de la vitrine (« Masqué sur la vitrine »). */
  masqueParPlan: boolean
  ordre: number
  creeLe: string
  modifieLe: string
}

export interface ServicesCompteursDTO {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
  limitePlan: LimitePlanDTO
}

/** Liste blanche publique : jamais id, vitrineId, ordre, actif, enVedette, dates. */
export interface ServicePublicCarteDTO {
  slug: string
  titre: string
  description: string | null
  image: MediaDTO | null
  type: ServiceType
  nbSeances: number | null
  rythme: Rythme | null
  dureeMin: number | null
  tarif: Tarif
  prixMontant: number | null
  prixDevise: Devise | null
  reservable: boolean
}

export interface ServicePublicDetailDTO extends ServicePublicCarteDTO {
  /** Mode effectif : forcé à `sur_place` tant que le paiement en ligne est désactivé. */
  paiementMode: PaiementMode | null
  paiementInstructions: string | null
  inclus: string[]
  seo: SeoPublicDTO
  /** ISO 8601 : `lastmod` et `og:updated_time`. */
  modifieLe: string
}

export interface ServicesStudioReponse {
  services: ServiceStudioDTO[]
  compteurs: ServicesCompteursDTO
}

export interface ServiceStudioReponse {
  service: ServiceStudioDTO
  compteurs: ServicesCompteursDTO
}

export interface ServicesPublicsReponse {
  total: number
  aLaUne: ServicePublicCarteDTO[]
  services: ServicePublicCarteDTO[]
}

export interface ServicePublicReponse {
  service: ServicePublicDetailDTO
  autres: ServicePublicCarteDTO[]
  total: number
}
