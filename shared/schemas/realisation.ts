import { z } from 'zod'

export const schemaRealisationCreate = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Le slug est requis.').max(100),
  titre: z.string().trim().min(1, 'Le titre est requis.').max(100),
  description: z.string().trim().max(1000).optional(),
  imageMediaId: z.string().optional(),
  annee: z.number().int().min(1900).max(2100).optional(),
  lieu: z.string().trim().max(100).optional(),
  role: z.string().trim().max(100).optional(),
  lien: z.string().trim().url('Lien invalide').max(200).optional(),
  enVedette: z.boolean().default(false),
  ordre: z.number().int().nonnegative().default(0),
  actif: z.boolean().default(true),
})

export const schemaRealisationUpdate = schemaRealisationCreate.partial()

export type RealisationCreateInput = z.infer<typeof schemaRealisationCreate>
export type RealisationUpdateInput = z.infer<typeof schemaRealisationUpdate>
