import type { OnboardingDTO, OnboardingPropositionDTO, ServiceProposeDTO } from '../../shared/dto'
import type { OnboardingView, PropositionBrouillon } from '../services/onboarding'
import type { ServiceBrouillon } from '../services/onboarding-regles'
import { toMediaResource } from './media'
import { asTitre } from './vitrine'

// S8 §3.5 : liste blanche de l'état d'inscription. L'étape 3 ajoute `actif` aux services (l'interrupteur
// choisi) ; ni identifiant d'utilisateur, ni date interne, ni chemin disque ne sortent.

function toServiceBrouillonResource(service: ServiceBrouillon): ServiceProposeDTO {
  return {
    titre: service.titre,
    description: service.description,
    type: service.type,
    dureeMin: service.dureeMin,
    nbSeances: service.nbSeances,
    actif: service.actif,
  }
}

function toPropositionResource(proposition: PropositionBrouillon): OnboardingPropositionDTO {
  return {
    accroche: proposition.accroche,
    presentation: proposition.presentation,
    services: proposition.services.map(toServiceBrouillonResource),
  }
}

export function toOnboardingResource(view: OnboardingView): OnboardingDTO {
  if (view.statut === 'termine') return { statut: 'termine', username: view.username }
  return {
    statut: 'en_cours',
    etapeReprise: view.etapeReprise,
    identite: {
      titre: asTitre(view.identite.titre),
      prenom: view.identite.prenom,
      nom: view.identite.nom,
      metier: view.identite.metier,
      ville: view.identite.ville,
      pays: view.identite.pays,
    },
    photo: view.photo ? toMediaResource(view.photo) : null,
    generationId: view.generationId,
    proposition: view.proposition ? toPropositionResource(view.proposition) : null,
    usernameSuggere: view.usernameSuggere,
  }
}
