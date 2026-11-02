import { z } from 'zod'
import { LISTE_REORDER_MAX, LISTE_SLUG_MAX, LISTE_SLUG_REGEX } from '../listes'

const champSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Le slug est requis.')
  .max(LISTE_SLUG_MAX)
  .regex(LISTE_SLUG_REGEX, 'Slug invalide.')

export const schemaTemoignageBase = z.strictObject({
  auteur: z.string().trim().min(1, 'L\'auteur est requis.').max(100),
  fonction: z.string().trim().max(100).optional(),
  texte: z.string().trim().min(1, 'Le texte est requis.').max(1000),
  enVedette: z.boolean(),
  actif: z.boolean(),
})

export const schemaTemoignageCreate = schemaTemoignageBase.extend({
  slug: champSlug,
  enVedette: z.boolean().default(false),
  ordre: z.number().int().nonnegative().default(0),
  actif: z.boolean().default(true),
})

export const schemaTemoignageUpdate = schemaTemoignageBase.partial()

export const schemaTemoignageParams = z.strictObject({
  slug: champSlug,
})

export const schemaTemoignageVisibilite = z.object({
  actif: z.boolean(),
})

export const schemaTemoignageVedette = z.object({
  enVedette: z.boolean(),
})

export const schemaTemoignageReorder = z.object({
  ids: z.array(z.string().uuid()).min(1, 'La liste des identifiants est requise.').max(LISTE_REORDER_MAX, 'Trop d\'identifiants.'),
})

export type TemoignageCreateInput = z.infer<typeof schemaTemoignageCreate>
export type TemoignageUpdateInput = z.infer<typeof schemaTemoignageUpdate>
export type TemoignageVisibiliteInput = z.infer<typeof schemaTemoignageVisibilite>
export type TemoignageVedetteInput = z.infer<typeof schemaTemoignageVedette>
export type TemoignageReorderInput = z.infer<typeof schemaTemoignageReorder>
