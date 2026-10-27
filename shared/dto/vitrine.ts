import type { Palette } from '../palettes'
import type { NextStep, PublicationField, Titre } from '../vitrine'
import type { MediaDTO } from './media'

export interface VitrineStudioDTO {
  username: string
  titre: Titre | null
  prenom: string
  nom: string
  nomAffiche: string
  metier: string
  ville: string | null
  pays: string | null
  accroche: string | null
  bio: string | null
  photo: MediaDTO | null
  emailContact: string | null
  telephone: string | null
  whatsapp: string | null
  palette: Palette
  fuseau: string
  publiee: boolean
  publieeLe: string | null
  creeLe: string
  modifieLe: string
}

export interface StudioResumeDTO {
  compteurs: {
    services: number
    realisations: number
    temoignages: number
    liens: number
  }
  prochaineEtape: NextStep | null
  manquantsPourPublier: PublicationField[]
  statistiques7j: { visites: 0, clics: 0, reservations: 0 }
}

export interface VitrinePubliqueDTO {
  username: string
  titre: Titre | null
  nomAffiche: string
  prenom: string
  nom: string
  metier: string
  ville: string
  pays: string
  paysLibelle: string
  accroche: string | null
  bio: string | null
  photo: MediaDTO | null
  contact: {
    email: string | null
    telephone: string | null
    whatsapp: string | null
  }
  palette: Palette
  fuseau: string
  seo: { titre: string, description: string }
}

/** Nombre d'éléments visibles (`actif`) par liste : alimente la navigation publique. */
export interface ContenusPublicsDTO {
  services: number
  realisations: number
}

/** Enveloppe de GET /api/public/:username. `vitrine` reste la liste blanche S2. */
export interface VitrinePubliqueReponse {
  vitrine: VitrinePubliqueDTO
  contenus: ContenusPublicsDTO
}
