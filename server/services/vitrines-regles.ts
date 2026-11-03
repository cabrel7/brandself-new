import { NEXT_STEPS, PUBLICATION_REQUIRED_FIELDS } from '../../shared/vitrine'
import type { NextStep, PublicationField } from '../../shared/vitrine'

// Règles pures de la vitrine (aucun accès base ni réseau) : testables sans infrastructure.

export type PublicationCandidate = Record<PublicationField, string | null | undefined>

/** Champs obligatoires encore vides (null, '' ou espaces), dans l'ordre canonique. */
export function computeMissingForPublication(vitrine: PublicationCandidate): PublicationField[] {
  return PUBLICATION_REQUIRED_FIELDS.filter((champ) => {
    const valeur = vitrine[champ]
    return valeur === null || valeur === undefined || valeur.trim() === ''
  })
}

export interface NextStepInput {
  hasPhoto: boolean
  servicesActifs: number
  /** Nombre de plages d'ouverture de l'agenda. */
  disponibilites: number
  realisationsActives: number
  /** La vitrine est publiée (`publiee_le` renseigné). */
  publiee: boolean
  /** La vitrine a déjà été partagée (`partagee_le` renseigné). */
  partagee: boolean
  /** Étapes que le professionnel ne veut plus se voir proposer (`vitrines.etapes_ignorees`). */
  ignorees: readonly NextStep[]
}

/**
 * Prochaine étape suggérée (S9 #93) : photo, premier service, disponibilités, première réalisation,
 * puis partager (seulement si la vitrine est publiée et pas encore partagée). Une étape ignorée est
 * sautée pour toujours, même si elle reste à faire : on passe à la suivante.
 */
export function computeNextStep(state: NextStepInput): NextStep | null {
  const ignorees = new Set<NextStep>(state.ignorees)
  const aFaire: Record<NextStep, boolean> = {
    photo: !state.hasPhoto,
    service: state.servicesActifs === 0,
    disponibilites: state.disponibilites === 0,
    realisation: state.realisationsActives === 0,
    partager: state.publiee && !state.partagee,
  }
  return NEXT_STEPS.find((etape) => aFaire[etape] && !ignorees.has(etape)) ?? null
}
