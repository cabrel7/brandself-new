import { PROCHAINES_ETAPES as DEFINITIONS } from '#shared/prochaine-etape'
import type { NextStep } from '#shared/vitrine'

// S9 : les libellés et chemins vivent dans shared/prochaine-etape.ts (lus aussi par le serveur).
// Ce fichier garde la forme historique (`to`) pour les composants existants.

/** Une « prochaine étape » proposée après l'inscription et sur l'accueil du studio. */
export interface ProchaineEtape {
  titre: string
  texte: string
  /** Page du studio où l'étape se réalise ; absent pour `partager` (l'action ouvre un panneau). */
  to?: string
  /** Libellé du bouton de l'accueil du studio. */
  action: string
}

/** Libellés et liens uniques, partagés par l'écran « C'est en ligne » et l'accueil du studio. */
export const PROCHAINES_ETAPES: Record<NextStep, ProchaineEtape> = Object.fromEntries(
  Object.entries(DEFINITIONS).map(([etape, definition]) => [
    etape,
    { titre: definition.titre, texte: definition.texte, to: definition.chemin ?? undefined, action: definition.action },
  ]),
) as Record<NextStep, ProchaineEtape>

/** Étape à afficher pour la valeur renvoyée par le serveur (`null` : tout est fait). */
export function prochaineEtape(etape: NextStep | null): ProchaineEtape | null {
  return etape ? PROCHAINES_ETAPES[etape] : null
}
