import { z } from 'zod'
import { AMELIORER_CHAMPS, AMELIORER_OBJECTIFS } from '../../../shared/ia'

// Entrées minimisées envoyées au fournisseur (S8 §0 #69) et stockées dans `generations_ia.entree`.
// Jamais le prénom, le nom, l'email ni le téléphone. Relues par Zod : la colonne est un JSON non typé.

export const schemaEntreeOnboarding = z.strictObject({
  titre: z.string().nullable(),
  metier: z.string(),
  ville: z.string(),
  pays: z.string(),
})

export const schemaEntreeAmelioration = z.strictObject({
  champ: z.enum(AMELIORER_CHAMPS),
  objectif: z.enum(AMELIORER_OBJECTIFS),
  texte: z.string(),
  contexte: z.strictObject({
    titre: z.string().nullable(),
    metier: z.string().nullable(),
    ville: z.string().nullable(),
    pays: z.string().nullable(),
  }),
})

export type EntreeOnboarding = z.infer<typeof schemaEntreeOnboarding>
export type EntreeAmelioration = z.infer<typeof schemaEntreeAmelioration>
export type EntreeIa = EntreeOnboarding | EntreeAmelioration
