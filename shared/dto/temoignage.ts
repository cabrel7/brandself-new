import type { LimitePlanDTO } from './abonnement'

export interface TemoignageStudioDTO {
  id: string
  slug: string
  auteur: string
  fonction: string | null
  texte: string
  enVedette: boolean
  actif: boolean
  /** S10 : actif mais au-delà de la limite du plan, donc absent de la vitrine (« Masqué sur la vitrine »). */
  masqueParPlan: boolean
  ordre: number
  creeLe: string
  modifieLe: string
}

export interface TemoignagesCompteursDTO {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
  limitePlan: LimitePlanDTO
}

/** Liste blanche publique : jamais id, vitrineId, ordre, actif, enVedette, dates. */
export interface TemoignagePublicCarteDTO {
  slug: string
  auteur: string
  fonction: string | null
  texte: string
}

export interface TemoignagesStudioReponse {
  temoignages: TemoignageStudioDTO[]
  compteurs: TemoignagesCompteursDTO
}

export interface TemoignageStudioReponse {
  temoignage: TemoignageStudioDTO
  compteurs: TemoignagesCompteursDTO
}

export interface TemoignagesPublicsReponse {
  total: number
  temoignages: TemoignagePublicCarteDTO[]
}
