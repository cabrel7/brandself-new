import type { OnboardingEtape } from '../onboarding'
import type { Titre } from '../vitrine'
import type { ServiceProposeDTO } from './ia'
import type { MediaDTO } from './media'
import type { StudioResumeDTO, VitrineStudioDTO } from './vitrine'

// S8 §3.5 : état de l'inscription guidée. L'étape de reprise est calculée, jamais stockée.

export interface OnboardingIdentiteDTO {
  titre: Titre | null
  prenom: string | null
  nom: string | null
  metier: string | null
  ville: string | null
  pays: string | null
}

export interface OnboardingPropositionDTO {
  accroche: string
  presentation: string
  services: ServiceProposeDTO[]
}

export interface OnboardingTermineDTO {
  statut: 'termine'
  username: string
}

export interface OnboardingEnCoursDTO {
  statut: 'en_cours'
  etapeReprise: OnboardingEtape
  identite: OnboardingIdentiteDTO
  photo: MediaDTO | null
  /** Null si absente, expirée ou purgée. */
  generationId: string | null
  /** Brouillon validé à l'étape 3. */
  proposition: OnboardingPropositionDTO | null
  /** `dr-cabrel` pour (dr, Cabrel, Nguesso) ; chaîne vide si l'identité est incomplète. */
  usernameSuggere: string
}

export type OnboardingDTO = OnboardingTermineDTO | OnboardingEnCoursDTO

export interface OnboardingReponse {
  onboarding: OnboardingDTO
}

/** Réponse de `terminer` : 201 à la création, 200 au rejeu. */
export interface OnboardingTerminerReponse {
  vitrine: VitrineStudioDTO
  resume: StudioResumeDTO
}
