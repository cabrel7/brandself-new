// A5 (D-A5-09, CA10) : entrées SYNTHÉTIQUES de l'essai à blanc d'un prompt. Figées dans le code : aucune donnée réelle
// (ni vitrine, ni compte, ni visiteur) n'est lue ni envoyée. Le corps de la route ne porte que le contenu du prompt.
import type { IaType } from '../../../shared/ia'
import type { EntreeAmelioration, EntreeIa, EntreeOnboarding, EntreeSeo } from './entrees'

const ENTREE_ONBOARDING: EntreeOnboarding = {
  titre: 'Coach',
  metier: 'coach en organisation',
  ville: 'Douala',
  pays: 'Cameroun',
}

const ENTREE_AMELIORATION: EntreeAmelioration = {
  champ: 'bio',
  objectif: 'reformuler',
  texte: 'Je suis coach et j’accompagne les personnes qui veulent mieux organiser leur quotidien à Douala.',
  contexte: { titre: 'Coach', metier: 'coach en organisation', ville: 'Douala', pays: 'Cameroun' },
}

const ENTREE_SEO: EntreeSeo = {
  metier: 'coach en organisation',
  ville: 'Douala',
  pays: 'Cameroun',
  accroche: 'Un accompagnement clair pour retrouver du temps',
}

export const ESSAI_FIXTURES: Readonly<Record<IaType, EntreeIa>> = {
  onboarding_vitrine: ENTREE_ONBOARDING,
  ameliorer_texte: ENTREE_AMELIORATION,
  seo_vitrine: ENTREE_SEO,
}
