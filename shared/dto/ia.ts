import type { AmeliorerChamp, GenerationProgression, GenerationStatut, IaPlan, IaType } from '../ia'
import type { ServiceType } from '../services'

// S8 §3.5 : DTO des générations IA. Jamais : entrée brute, motif détaillé, tokens, fournisseur, erreur, prompt.

export interface ServiceProposeBaseDTO {
  titre: string
  description: string
  type: ServiceType
  dureeMin: number | null
  nbSeances: number | null
}

export interface ServiceProposeDTO extends ServiceProposeBaseDTO {
  actif: boolean
}

export interface PropositionOnboardingDTO {
  accroches: string[]
  presentation: string
  services: ServiceProposeBaseDTO[]
}

export interface AmeliorationDTO {
  champ: AmeliorerChamp
  avant: string
  apres: string
  modifie: boolean
}

interface GenerationBaseDTO {
  id: string
  statut: GenerationStatut
  progression: GenerationProgression
  /** Vrai pour les statuts `repli` et `expiree` : le contenu est un texte préparé sans IA. */
  repli: boolean
}

export interface GenerationOnboardingDTO extends GenerationBaseDTO {
  type: Extract<IaType, 'onboarding_vitrine'>
  resultat: PropositionOnboardingDTO | null
}

export interface GenerationAmelioreeDTO extends GenerationBaseDTO {
  type: Extract<IaType, 'ameliorer_texte'>
  resultat: AmeliorationDTO | null
}

/** Union discriminée par `type` ; `resultat` est non nul dès qu'un état terminal est atteint. */
export type GenerationDTO = GenerationOnboardingDTO | GenerationAmelioreeDTO

export interface QuotaIaDTO {
  plan: IaPlan
  limite: number | null
  utilisees: number
  restantes: number | null
  depasse: boolean
}

export interface GenerationReponse {
  generation: GenerationDTO
}

/** Réponse de `generer` et `ameliorer` (202, ou 200 en dédoublonnage). */
export interface GenerationLanceeReponse {
  generation: GenerationDTO
  quota: QuotaIaDTO
}
