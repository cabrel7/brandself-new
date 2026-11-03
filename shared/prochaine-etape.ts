import type { NextStep } from './vitrine'

// S9 (docs/specs/S9-notifications.md §3.4) : déplacé depuis app/utils pour être lu aussi par le
// serveur (suggestion du résumé hebdomadaire). Pur.

/** Une « prochaine étape » proposée après l'inscription, sur l'accueil du studio et dans le résumé. */
export interface ProchaineEtapeDefinition {
  titre: string
  texte: string
  /** Page du studio où l'étape se réalise ; `null` : l'action ouvre un panneau (partager). */
  chemin: string | null
  /** Libellé du bouton de l'accueil du studio. */
  action: string
}

export const PROCHAINES_ETAPES: Record<NextStep, ProchaineEtapeDefinition> = {
  photo: {
    titre: 'Ajoutez votre photo',
    texte: 'Un visage rassure vos visiteurs dès les premières secondes.',
    chemin: '/studio/profil',
    action: 'Ajouter',
  },
  service: {
    titre: 'Ajoutez votre premier service',
    texte: 'Vos visiteurs sauront tout de suite ce que vous proposez.',
    chemin: '/studio/services/nouveau',
    action: 'Ajouter',
  },
  disponibilites: {
    titre: 'Ouvrez vos disponibilités',
    texte: 'Vos visiteurs pourront réserver un rendez-vous directement.',
    chemin: '/studio/agenda/disponibilites',
    action: 'Ouvrir',
  },
  realisation: {
    titre: 'Présentez une réalisation',
    texte: 'Montrez un travail dont vous êtes fier.',
    chemin: '/studio/realisations/nouveau',
    action: 'Ajouter',
  },
  partager: {
    titre: 'Partagez votre vitrine',
    texte: 'Un message à vos contacts suffit souvent pour recevoir vos premières visites.',
    chemin: null,
    action: 'Partager',
  },
}
