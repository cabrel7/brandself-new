import { z } from 'zod'
import { validateUsername } from './username'

export const schemaVitrineCreate = z.object({
  titre: z.string().trim().min(1, 'Le titre est requis.').max(100, 'Le titre est trop long.'),
  prenom: z.string().trim().min(1, 'Le prénom est requis.').max(50),
  nom: z.string().trim().min(1, 'Le nom est requis.').max(50),
  metier: z.string().trim().min(1, 'Le métier est requis.').max(100),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'L\'adresse doit contenir au moins 3 caractères.')
    .max(30, 'L\'adresse est trop longue.')
    .refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), {
      message: 'Minuscules, chiffres et tirets uniquement, sans tiret en début, fin ni doublement.',
    })
    .superRefine((value, ctx) => {
      if (!validateUsername(value).success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Cette adresse est réservée.',
        })
      }
    }),
})

export const schemaVitrineUpdate = schemaVitrineCreate.partial().omit({ username: true })

export type VitrineCreateInput = z.infer<typeof schemaVitrineCreate>
export type VitrineUpdateInput = z.infer<typeof schemaVitrineUpdate>
