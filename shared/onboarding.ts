// S8 §3.2 : constantes du parcours d'inscription guidée (pur).

export type OnboardingEtape = 1 | 2 | 3 | 4

export const ONBOARDING_ETAPES: Record<OnboardingEtape, string> = {
  1: 'Qui êtes-vous ?',
  2: 'Votre photo',
  3: 'Notre proposition',
  4: 'Votre adresse',
}

export const ONBOARDING_ETAPES_TOTAL = 4

/** Délai de saisie avant la vérification en direct de l'adresse. */
export const USERNAME_DEBOUNCE_MS = 450

export const PAYS_DEFAUT = 'CM'

/** Suggestions de l'étape 1 : liste d'aide, la saisie libre reste acceptée. */
export const METIERS_SUGGERES = [
  'Médecin généraliste',
  'Cardiologue',
  'Pédiatre',
  'Gynécologue',
  'Dentiste',
  'Psychologue',
  'Kinésithérapeute',
  'Infirmier',
  'Sage-femme',
  'Nutritionniste',
  'Avocat',
  'Notaire',
  'Huissier de justice',
  'Expert-comptable',
  'Consultant',
  'Coach professionnel',
  'Coach de vie',
  'Formateur',
  'Enseignant particulier',
  'Traducteur',
  'Photographe',
  'Graphiste',
  'Architecte',
  'Développeur web',
  'Community manager',
  'Esthéticienne',
  'Coiffeur',
  'Styliste',
  'Agent immobilier',
  'Wedding planner',
] as const

export const ONBOARDING_MANQUANTS = ['identite', 'photo', 'proposition'] as const
export type OnboardingManquant = (typeof ONBOARDING_MANQUANTS)[number]
