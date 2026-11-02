import { z } from 'zod'
import type { IaType } from '../../../shared/ia'
import { schemaPropositionOnboarding, schemaTexteAmeliore } from '../../../shared/schemas/ia'
import type { IaOutil } from './types'

// S8 §4.6 : la sortie du modèle est forcée par un outil (tool use) dont le schéma vient de Zod.
// Nom et description de l'outil sont des métadonnées techniques (pas un prompt) ; les consignes
// restent en base (`prompts_ia`).

export const OUTIL_PROPOSER_VITRINE = 'proposer_vitrine'
export const OUTIL_PROPOSER_TEXTE = 'proposer_texte'

function schemaJson(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _version, ...reste } = z.toJSONSchema(schema)
  return reste
}

export function outilPour(type: IaType): IaOutil {
  if (type === 'onboarding_vitrine') {
    return {
      nom: OUTIL_PROPOSER_VITRINE,
      description: 'Enregistre la proposition de vitrine',
      schema: schemaJson(schemaPropositionOnboarding),
    }
  }
  return {
    nom: OUTIL_PROPOSER_TEXTE,
    description: 'Enregistre le texte amélioré',
    schema: schemaJson(schemaTexteAmeliore),
  }
}
