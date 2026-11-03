import { z } from 'zod'
import { DEVISES, LOCALES } from '../compte'
import { isValidTimeZone } from '../fuseau'

export const schemaMoiUpdate = z
  .object({
    locale: z.enum(LOCALES, 'Langue inconnue.'),
    devise: z.enum(DEVISES, 'Devise inconnue.'),
    fuseau: z.string().refine(isValidTimeZone, 'Fuseau horaire inconnu.'),
    // S9 : préférences d'e-mails (résumé du lundi, rendez-vous du jour).
    emailHebdo: z.boolean('Choix invalide.'),
    emailRappelJour: z.boolean('Choix invalide.'),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification à enregistrer.')

export const schemaAccountDeletion = z.object({ confirmation: z.string() }).strict()

export type MoiUpdateInput = z.infer<typeof schemaMoiUpdate>
export type AccountDeletionInput = z.infer<typeof schemaAccountDeletion>
