import { z } from 'zod'
import { estReserve } from '../reserved'

export const schemaUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'au moins 3 caractères')
  .max(30, '30 caractères au maximum')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'minuscules, chiffres et tirets uniquement, sans tiret en début, fin ni doublement')
  .refine((valeur) => !estReserve(valeur), 'ce nom est réservé')

export type ResultatUsername = ReturnType<typeof schemaUsername.safeParse>

export function validerUsername(valeur: string): ResultatUsername {
  return schemaUsername.safeParse(valeur)
}
