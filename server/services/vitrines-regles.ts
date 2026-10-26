import { PUBLICATION_REQUIRED_FIELDS } from '../../shared/vitrine'
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
  realisationsActives: number
}

/** Prochaine étape suggérée : photo, puis premier service, puis première réalisation. */
export function computeNextStep(state: NextStepInput): NextStep | null {
  if (!state.hasPhoto) return 'photo'
  if (state.servicesActifs === 0) return 'service'
  if (state.realisationsActives === 0) return 'realisation'
  return null
}
