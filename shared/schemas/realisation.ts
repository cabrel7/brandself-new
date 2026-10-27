import { z } from 'zod'
import { LISTE_REORDER_MAX } from '../listes'
import {
  ANNEE_MAX,
  ANNEE_MIN,
  GALERIE_MAX,
  REALISATION_DESCRIPTION_MAX,
  REALISATION_LIEN_MAX,
  REALISATION_LIEU_MAX,
  REALISATION_ROLE_MAX,
  REALISATION_TITRE_MAX,
  normaliserLien,
} from '../realisations'
import { nullable } from './aides'

const MESSAGE_LIEN = 'Saisissez une adresse web valide, par exemple https://exemple.com.'
const MESSAGE_IMAGE_REQUISE = 'Ajoutez une image principale.'
const MESSAGE_IMAGE_INVALIDE = 'Image invalide.'

function sansDoublon(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length
}

const champs = {
  titre: z
    .string()
    .trim()
    .min(1, 'Le titre est requis.')
    .max(REALISATION_TITRE_MAX, `Le titre est limité à ${REALISATION_TITRE_MAX} caractères.`),
  description: nullable(
    z.string().max(REALISATION_DESCRIPTION_MAX, `La description est limitée à ${REALISATION_DESCRIPTION_MAX} caractères.`),
  ),
  /** Non nullable : l'image principale se remplace, elle ne se retire pas (décision #47). */
  imageMediaId: z.uuid({
    error: (iss) => (iss.input == null ? MESSAGE_IMAGE_REQUISE : MESSAGE_IMAGE_INVALIDE),
  }),
  galerie: z
    .array(z.uuid(MESSAGE_IMAGE_INVALIDE))
    .max(GALERIE_MAX, `La galerie compte ${GALERIE_MAX} images au maximum.`)
    .refine(sansDoublon, 'Une image ne peut apparaître qu’une fois dans la galerie.'),
  annee: z
    .int('L’année doit être un nombre entier.')
    .min(ANNEE_MIN, `L’année doit être comprise entre ${ANNEE_MIN} et ${ANNEE_MAX}.`)
    .max(ANNEE_MAX, `L’année doit être comprise entre ${ANNEE_MIN} et ${ANNEE_MAX}.`)
    .nullable(),
  lieu: nullable(z.string().max(REALISATION_LIEU_MAX, `Le lieu est limité à ${REALISATION_LIEU_MAX} caractères.`)),
  role: nullable(z.string().max(REALISATION_ROLE_MAX, `Le rôle est limité à ${REALISATION_ROLE_MAX} caractères.`)),
  lien: z.preprocess(
    normaliserLien,
    z
      .url({ protocol: /^https?$/, hostname: z.regexes.domain, error: MESSAGE_LIEN })
      .max(REALISATION_LIEN_MAX, `Le lien est limité à ${REALISATION_LIEN_MAX} caractères.`)
      .nullable(),
  ),
  enVedette: z.boolean(),
  actif: z.boolean(),
}

/** `enVedette` absent = automatique (décidé par le service selon le plafond). */
export const schemaRealisationCreate = z
  .object({
    titre: champs.titre,
    description: champs.description.default(null),
    imageMediaId: champs.imageMediaId,
    galerie: champs.galerie.default([]),
    annee: champs.annee.default(null),
    lieu: champs.lieu.default(null),
    role: champs.role.default(null),
    lien: champs.lien.default(null),
    enVedette: champs.enVedette.optional(),
    actif: champs.actif.default(true),
  })
  .strict()

/**
 * Mise à jour partielle. La cohérence entre champs (image principale hors galerie, vedette
 * et visibilité) est évaluée par le service sur l'état fusionné. `galerie` présente =
 * remplacement complet ; `imageMediaId: null` est refusé.
 */
export const schemaRealisationUpdate = z
  .object(champs)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification à enregistrer.')

export const schemaRealisationReorder = z
  .object({ ids: z.array(z.uuid('Identifiant invalide.')).min(1).max(LISTE_REORDER_MAX) })
  .strict()
  .refine((value) => sansDoublon(value.ids), {
    path: ['ids'],
    message: 'Une réalisation ne peut apparaître qu’une fois.',
  })

/** Entrée parsée (défauts appliqués). */
export type RealisationCreateInput = z.infer<typeof schemaRealisationCreate>
/** Entrée avant parsing (défauts facultatifs) : ce que le client peut envoyer. */
export type RealisationCreateRaw = z.input<typeof schemaRealisationCreate>
export type RealisationUpdateInput = z.infer<typeof schemaRealisationUpdate>
export type RealisationReorderInput = z.infer<typeof schemaRealisationReorder>
