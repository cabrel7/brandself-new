import { z } from 'zod'
import { isReserved } from '../reserved'

const USERNAME_LONGUEUR_MAX = 30

export const schemaUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'au moins 3 caractères')
  .max(USERNAME_LONGUEUR_MAX, `${USERNAME_LONGUEUR_MAX} caractères au maximum`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'minuscules, chiffres et tirets uniquement, sans tiret en début, fin ni doublement')
  .refine((value) => !isReserved(value), 'ce nom est réservé')

export type UsernameResult = ReturnType<typeof schemaUsername.safeParse>

export function validateUsername(value: string): UsernameResult {
  return schemaUsername.safeParse(value)
}

/**
 * Mise en forme AUTOMATIQUE de ce que l'on saisit dans le champ d'adresse, pour ne jamais afficher d'erreur de format
 * quand on peut corriger soi-même : minuscules, accents retirés, espaces / points / apostrophes / soulignés
 * en tirets, autres caractères retirés, tirets doublés réduits, pas de tiret en tête, 30 caractères au plus.
 * Le tiret final est conservé : on est peut-être en train d'écrire la suite (« dr- » avant « dr-cabrel »).
 * La validation serveur (`schemaUsername`) reste stricte : cette fonction ne la remplace pas.
 */
export function formaterUsernameSaisie(brut: string): string {
  return brut
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_.'’]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, USERNAME_LONGUEUR_MAX)
}

/** Même mise en forme, plus le retrait des tirets de fin (à la sortie du champ ou à l'envoi). */
export function finaliserUsernameSaisie(brut: string): string {
  return formaterUsernameSaisie(brut).replace(/-+$/, '')
}

export const schemaUsernameQuery = z.object({
  username: z.string().max(64),
})
