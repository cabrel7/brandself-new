import { z } from 'zod'
import type { IaType } from '../../../shared/ia'
import { schemaPropositionOnboardingOutil, schemaSeoIa, schemaTexteAmeliore } from '../../../shared/schemas/ia'
import type { IaOutil } from './types'

// S8 §4.6 : la sortie du modèle est forcée par un outil (tool use) dont le schéma vient de Zod.
// Nom et description de l'outil sont des métadonnées techniques (pas un prompt) ; les consignes
// restent en base (`prompts_ia`).

export const OUTIL_PROPOSER_VITRINE = 'proposer_vitrine'
export const OUTIL_PROPOSER_TEXTE = 'proposer_texte'
/** Décision #24 : SEO d'une vitrine existante (titre et description pour les moteurs de recherche). */
export const OUTIL_PROPOSER_SEO = 'proposer_seo'

function schemaJson(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _version, ...reste } = z.toJSONSchema(schema)
  return reste
}

export function outilPour(type: IaType): IaOutil {
  if (type === 'onboarding_vitrine') {
    return {
      nom: OUTIL_PROPOSER_VITRINE,
      description: 'Enregistre la proposition de vitrine',
      // Prompt v2 : le bloc « seo » est obligatoire pour le modèle (la validation, elle, le tolère absent).
      schema: schemaJson(schemaPropositionOnboardingOutil),
    }
  }
  if (type === 'seo_vitrine') {
    return {
      nom: OUTIL_PROPOSER_SEO,
      description: 'Enregistre le titre et la description pour les moteurs de recherche',
      schema: schemaJson(schemaSeoIa),
    }
  }
  return {
    nom: OUTIL_PROPOSER_TEXTE,
    description: 'Enregistre le texte amélioré',
    schema: schemaJson(schemaTexteAmeliore),
  }
}
