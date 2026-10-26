import { z } from 'zod'

export const schemaLienCreate = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Le slug est requis.').max(100),
  libelle: z.string().trim().min(1, 'Le libellé est requis.').max(100),
  url: z.string().trim().url('Lien invalide.'),
  type: z.enum(['libre', 'whatsapp', 'reseau', 'email', 'telephone', 'vitrine']),
  ordre: z.number().int().nonnegative().default(0),
  actif: z.boolean().default(true),
})

export const schemaLienUpdate = schemaLienCreate.partial()

export type LienCreateInput = z.infer<typeof schemaLienCreate>
export type LienUpdateInput = z.infer<typeof schemaLienUpdate>
