import { z } from 'zod'

export const schemaServiceCreate = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Le slug est requis.').max(100),
  titre: z.string().trim().min(1, 'Le titre est requis.').max(100),
  description: z.string().trim().max(1000).optional(),
  type: z.enum(['rdv', 'accompagnement', 'atelier', 'devis']),
  nbSeances: z.number().int().positive().optional(),
  rythme: z.string().trim().max(50).optional(),
  dureeMin: z.number().int().positive('La durée doit être positive.'),
  tarif: z.enum(['gratuit', 'payant', 'devis']),
  prixMontant: z.number().int().nonnegative().optional(),
  prixDevise: z.string().trim().min(3).max(3).optional(),
  paiementMode: z.enum(['en_ligne', 'sur_place', 'au_choix']).optional(),
  paiementInstructions: z.string().trim().max(500).optional(),
  reservable: z.boolean().default(true),
  enVedette: z.boolean().default(false),
  ordre: z.number().int().nonnegative().default(0),
  actif: z.boolean().default(true),
})

export const schemaServiceUpdate = schemaServiceCreate.partial()

export type ServiceCreateInput = z.infer<typeof schemaServiceCreate>
export type ServiceUpdateInput = z.infer<typeof schemaServiceUpdate>
