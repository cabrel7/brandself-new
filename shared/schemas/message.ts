import { z } from 'zod'
import { MESSAGE_EMAIL_MAX, MESSAGE_MAX, MESSAGE_NOM_MAX, MESSAGE_TELEPHONE_MAX, SUJETS_MESSAGE } from '../message'
import { E164_REGEX } from '../telephone'

// S7-bis §4.4 : schéma strict du formulaire public de contact. Le honeypot `siteWeb`
// est un littéral vide requis (absent = rejeté, strict) ; le téléphone est E.164
// facultatif (absent, jamais null) ; le sujet est l'un des 4 sujets tranchés.

export const schemaMessageCreate = z
  .object({
    nom: z.string().trim().min(1, 'Votre nom est requis.').max(MESSAGE_NOM_MAX),
    email: z.email('Adresse email invalide.').max(MESSAGE_EMAIL_MAX),
    telephone: z.string().regex(E164_REGEX, 'Numéro de téléphone invalide.').max(MESSAGE_TELEPHONE_MAX).optional(),
    sujet: z.enum(SUJETS_MESSAGE),
    message: z.string().trim().min(1, 'Votre message est requis.').max(MESSAGE_MAX),
    siteWeb: z.literal(''),
  })
  .strict()

export const schemaMessageIdParams = z.object({ id: z.uuid('Identifiant invalide.') }).strict()

export const schemaMessageLu = z.object({}).strict()
