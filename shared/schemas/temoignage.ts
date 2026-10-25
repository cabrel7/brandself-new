import { z } from 'zod'

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

export type TemoignageCreateInput = z.infer<typeof schemaTemoignageCreate>
export type TemoignageUpdateInput = z.infer<typeof schemaTemoignageUpdate>
