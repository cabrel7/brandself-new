import { z } from 'zod'
import { ACCROCHES_PROPOSEES, SERVICES_PROPOSES } from '../ia'
import { PALETTES } from '../palettes'
import { BIO_MAX, PAYS_CODES, VILLE_MAX } from '../vitrine'
import { champMetier, champNom, champPrenom, champTitre } from './vitrine'
import { schemaUsername } from './username'

// S8 §3.3 : une étape = un schéma strict ; l'union est discriminée par `etape`.

export const schemaOnboardingIdentite = z.strictObject({
  etape: z.literal(1),
  titre: champTitre,
  prenom: champPrenom,
  nom: champNom,
  metier: champMetier,
  ville: z.string().trim().min(1, 'La ville est requise.').max(VILLE_MAX, 'La ville est trop longue.'),
  pays: z.enum(PAYS_CODES, 'Pays inconnu.'),
})

export const schemaOnboardingPhoto = z.strictObject({
  etape: z.literal(2),
  photoMediaId: z.uuid('Photo invalide.'),
})

/** Le client envoie des choix (index, interrupteurs), jamais le contenu des services. */
export const schemaOnboardingProposition = z.strictObject({
  etape: z.literal(3),
  accrocheIndex: z.int().min(0).max(ACCROCHES_PROPOSEES - 1),
  presentation: z
    .string()
    .trim()
    .min(1, 'Écrivez quelques mots de présentation.')
    .max(BIO_MAX, `La présentation est limitée à ${BIO_MAX} caractères.`),
  servicesActifs: z.array(z.boolean()).length(SERVICES_PROPOSES),
})

export const schemaOnboardingEtape = z.discriminatedUnion('etape', [
  schemaOnboardingIdentite,
  schemaOnboardingPhoto,
  schemaOnboardingProposition,
])

export const schemaOnboardingTerminer = z.strictObject({
  username: schemaUsername,
  palette: z.enum(PALETTES, 'Palette inconnue.'),
})

/** Corps de `generer` : vide et strict. */
export const schemaOnboardingGenerer = z.strictObject({})

/** Un identifiant invalide est traité comme introuvable (404) par la route : pas de 400. */
export const schemaGenerationIdParams = z.strictObject({ id: z.uuid() })

export type OnboardingIdentiteInput = z.infer<typeof schemaOnboardingIdentite>
export type OnboardingPhotoInput = z.infer<typeof schemaOnboardingPhoto>
export type OnboardingPropositionInput = z.infer<typeof schemaOnboardingProposition>
export type OnboardingEtapeInput = z.infer<typeof schemaOnboardingEtape>
export type OnboardingTerminerInput = z.infer<typeof schemaOnboardingTerminer>
