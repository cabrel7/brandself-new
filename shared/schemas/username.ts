import { z } from 'zod'
import { isReserved } from '../reserved'

export const schemaUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'au moins 3 caractères')
  .max(30, '30 caractères au maximum')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'minuscules, chiffres et tirets uniquement, sans tiret en début, fin ni doublement')
  .refine((value) => !isReserved(value), 'ce nom est réservé')

export type UsernameResult = ReturnType<typeof schemaUsername.safeParse>

export function validateUsername(value: string): UsernameResult {
  return schemaUsername.safeParse(value)
}
