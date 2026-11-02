import type { PropositionOnboardingDTO } from '#shared/dto'
import type { OnboardingEtape } from '#shared/onboarding'
import { metaStudio } from '#shared/services'
import { TITRES } from '#shared/vitrine'
import type { Titre } from '#shared/vitrine'

/** Valeur du sélecteur pour « pas de titre » (le serveur attend `null`). */
export const TITRE_AUCUN = 'aucun'

export const HOTE_VITRINES = 'brandself.io'

const SECONDES_PAR_MINUTE = 60

/** Titre de l'écran (`h1`) : celui de l'étape 3 et 4 est plus long que le libellé de la barre de progression. */
export const TITRES_ECRAN: Record<OnboardingEtape, string> = {
  1: 'Qui êtes-vous ?',
  2: 'Votre photo',
  3: 'Voici notre proposition',
  4: 'Choisissez votre adresse',
}

export const SOUS_TITRES_ECRAN: Record<OnboardingEtape, string> = {
  1: 'Bienvenue. Construisons votre vitrine ensemble.',
  2: 'C’est la première chose que vos visiteurs regardent.',
  3: 'Nous avons rédigé une première version pour vous. Choisissez, corrigez, c’est vous qui décidez.',
  4: 'C’est le lien que vous partagerez à vos patients et clients.',
}

export const SOUS_TITRE_REPLI =
  'Nous avons préparé une première version à partir de vos réponses. Modifiez-la librement, c’est vous qui décidez.'

export const MESSAGE_ATTENTE = 'Nous rédigeons votre proposition. Cela prend quelques secondes.'
export const MESSAGE_ATTENTE_LONGUE = 'Encore un instant, nous relisons chaque phrase.'

/** Formulaire de l'étape 1 (valeurs de saisie, avant envoi). */
export interface IdentiteForm {
  titre: string
  prenom: string
  nom: string
  metier: string
  ville: string
  pays: string
}

/** Ligne de méta d'un service proposé : aucun prix n'est inventé, tout est « Sur devis ». */
export function metaServicePropose(service: PropositionOnboardingDTO['services'][number]): string {
  return metaStudio({ type: service.type, tarif: 'devis', nbSeances: service.nbSeances, dureeMin: service.dureeMin, actif: true })
}

/** `retryAfter` (secondes) -> message de patience pour une limite de demandes IA atteinte. */
export function messageTropDeDemandes(retryAfter: number | null): string {
  if (retryAfter === null) return 'Vous avez demandé beaucoup de propositions. Réessayez dans un moment.'
  const minutes = Math.max(1, Math.ceil(retryAfter / SECONDES_PAR_MINUTE))
  return `Vous avez demandé beaucoup de propositions. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
}

/** Valeur du sélecteur de titre -> titre envoyé au serveur (`null` = sans titre). */
export function versTitre(valeur: string): Titre | null {
  return TITRES.find((titre) => titre === valeur) ?? null
}
