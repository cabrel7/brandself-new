export interface TemoignageStudioDTO {
  id: string
  slug: string
  auteur: string
  fonction: string | null
  texte: string
  enVedette: boolean
  actif: boolean
  ordre: number
  creeLe: string
  modifieLe: string
}

export interface TemoignagesCompteursDTO {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
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
