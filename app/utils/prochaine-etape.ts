import type { NextStep } from '#shared/vitrine'

/** Une « prochaine étape » proposée après l'inscription et sur l'accueil du studio. */
export interface ProchaineEtape {
  titre: string
  texte: string
  /** Page du studio où l'étape se réalise. */
  to: string
  /** Libellé du bouton de l'accueil du studio. */
  action: string
}

/** Libellés et liens uniques, partagés par l'écran « C'est en ligne » et l'accueil du studio. */
export const PROCHAINES_ETAPES: Record<NextStep, ProchaineEtape> = {
  photo: {
    titre: 'Ajoutez votre photo',
    texte: 'Un visage rassure vos visiteurs dès les premières secondes.',
    to: '/studio/profil',
    action: 'Ajouter',
  },
  service: {
    titre: 'Ajoutez votre premier service',
    texte: 'Vos visiteurs sauront tout de suite ce que vous proposez.',
    to: '/studio/services/nouveau',
    action: 'Ajouter',
  },
  disponibilites: {
    titre: 'Ouvrez vos disponibilités',
    texte: 'Vos visiteurs pourront réserver un rendez-vous directement.',
    to: '/studio/agenda/disponibilites',
    action: 'Ouvrir',
  },
  realisation: {
    titre: 'Présentez une réalisation',
    texte: 'Montrez un travail dont vous êtes fier.',
    to: '/studio/realisations/nouveau',
    action: 'Ajouter',
  },
}

/** Étape à afficher pour la valeur renvoyée par le serveur (`null` : tout est fait). */
export function prochaineEtape(etape: NextStep | null): ProchaineEtape | null {
  return etape ? PROCHAINES_ETAPES[etape] : null
}
