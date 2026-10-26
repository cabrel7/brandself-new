import { z } from 'zod'
import { DEVISES } from '../compte'
import { PRIX_MAX_MINOR } from '../devises'
import {
  DUREE_MIN_MAX,
  DUREE_MIN_MIN,
  INCLUS_LIGNE_MAX,
  INCLUS_MAX,
  PAIEMENT_INSTRUCTIONS_MAX,
  PAIEMENT_MODES,
  RYTHMES,
  SEANCES_MAX,
  SEANCES_MIN,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_TITRE_MAX,
  SERVICE_TYPES,
  SERVICES_REORDER_MAX,
  TARIFS,
} from '../services'

/** '' ou espaces seuls -> null ; les autres chaînes sont rognées (même règle que schemas/vitrine). */
function blankToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function nullable<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToNull, schema.nullable())
}

/** Rogne chaque ligne et retire les lignes vides. */
function cleanLines(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value
    .map((ligne: unknown) => (typeof ligne === 'string' ? ligne.trim() : ligne))
    .filter((ligne: unknown) => ligne !== '')
}

const champs = {
  titre: z
    .string()
    .trim()
    .min(1, 'Le titre est requis.')
    .max(SERVICE_TITRE_MAX, `Le titre est limité à ${SERVICE_TITRE_MAX} caractères.`),
  description: nullable(
    z.string().max(SERVICE_DESCRIPTION_MAX, `La description est limitée à ${SERVICE_DESCRIPTION_MAX} caractères.`),
  ),
  imageMediaId: z.uuid('Photo invalide.').nullable(),
  type: z.enum(SERVICE_TYPES, 'Type de service inconnu.'),
  nbSeances: z
    .int('Le nombre de séances doit être un nombre entier.')
    .min(SEANCES_MIN, `Un accompagnement compte au moins ${SEANCES_MIN} séances.`)
    .max(SEANCES_MAX, `Un accompagnement compte au plus ${SEANCES_MAX} séances.`)
    .nullable(),
  rythme: nullable(z.enum(RYTHMES, 'Rythme inconnu.')),
  dureeMin: z
    .int('La durée doit être un nombre entier de minutes.')
    .min(DUREE_MIN_MIN, `La durée minimale est de ${DUREE_MIN_MIN} minutes.`)
    .max(DUREE_MIN_MAX, `La durée maximale est de ${DUREE_MIN_MAX} minutes.`)
    .nullable(),
  tarif: z.enum(TARIFS, 'Tarif inconnu.'),
  prixMontant: z
    .int('Le prix doit être un montant entier, en plus petite unité de la devise.')
    .min(1, 'Le prix doit être supérieur à zéro.')
    .max(PRIX_MAX_MINOR, 'Ce prix est trop élevé.')
    .nullable(),
  prixDevise: nullable(z.enum(DEVISES, 'Devise inconnue.')),
  paiementMode: nullable(z.enum(PAIEMENT_MODES, 'Mode de règlement inconnu.')),
  paiementInstructions: nullable(
    z.string().max(PAIEMENT_INSTRUCTIONS_MAX, `Les instructions sont limitées à ${PAIEMENT_INSTRUCTIONS_MAX} caractères.`),
  ),
  inclus: z.preprocess(
    cleanLines,
    z
      .array(z.string().max(INCLUS_LIGNE_MAX, `Chaque ligne est limitée à ${INCLUS_LIGNE_MAX} caractères.`))
      .max(INCLUS_MAX, `Vous pouvez saisir ${INCLUS_MAX} lignes au maximum.`),
  ),
  reservable: z.boolean(),
  enVedette: z.boolean(),
  actif: z.boolean(),
}

/** `enVedette` absent = automatique (décidé par le service selon le plafond). */
export const schemaServiceCreate = z
  .object({
    titre: champs.titre,
    description: champs.description.default(null),
    imageMediaId: champs.imageMediaId.default(null),
    type: champs.type,
    nbSeances: champs.nbSeances.default(null),
    rythme: champs.rythme.default(null),
    dureeMin: champs.dureeMin.default(null),
    tarif: champs.tarif,
    prixMontant: champs.prixMontant.default(null),
    prixDevise: champs.prixDevise.default(null),
    paiementMode: champs.paiementMode.default(null),
    paiementInstructions: champs.paiementInstructions.default(null),
    inclus: champs.inclus.default([]),
    reservable: champs.reservable.default(true),
    enVedette: champs.enVedette.optional(),
    actif: champs.actif.default(true),
  })
  .strict()

/**
 * Mise à jour partielle. La cohérence entre champs (durée, séances, prix, vedette) n'est pas
 * vérifiée ici : le service l'évalue sur l'état fusionné (base + modification).
 */
export const schemaServiceUpdate = z
  .object(champs)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification à enregistrer.')

export const schemaServiceReorder = z
  .object({ ids: z.array(z.uuid('Identifiant invalide.')).min(1).max(SERVICES_REORDER_MAX) })
  .strict()
  .refine((value) => new Set(value.ids).size === value.ids.length, {
    path: ['ids'],
    message: 'Un service ne peut apparaître qu’une fois.',
  })

/** Entrée parsée (défauts appliqués). */
export type ServiceCreateInput = z.infer<typeof schemaServiceCreate>
/** Entrée avant parsing (défauts facultatifs) : ce que le client peut envoyer. */
export type ServiceCreateRaw = z.input<typeof schemaServiceCreate>
export type ServiceUpdateInput = z.infer<typeof schemaServiceUpdate>
export type ServiceReorderInput = z.infer<typeof schemaServiceReorder>
