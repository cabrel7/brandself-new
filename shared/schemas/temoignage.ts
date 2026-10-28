import { z } from 'zod'
import { LISTE_REORDER_MAX } from '../../shared/listes'

export const schemaTemoignageCreate = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Le slug est requis.').max(100),
  auteur: z.string().trim().min(1, 'L\'auteur est requis.').max(100),
  fonction: z.string().trim().max(100).optional(),
  texte: z.string().trim().min(1, 'Le texte est requis.').max(1000),
  enVedette: z.boolean().default(false),
  ordre: z.number().int().nonnegative().default(0),
  actif: z.boolean().default(true),
})

export const schemaTemoignageUpdate = schemaTemoignageCreate.partial()

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
