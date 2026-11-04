import { z } from 'zod'
import { E164_REGEX } from '../telephone'
import { PALETTES } from '../palettes'
import {
  ACCROCHE_MAX,
  BIO_MAX,
  METIER_MAX,
  NOM_MAX,
  PAYS_CODES,
  PRENOM_MAX,
  TITRES,
  VILLE_MAX,
} from '../vitrine'
import { SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_MIN, SEO_TITRE_MAX, SEO_TITRE_MIN } from '../seo'
import { schemaUsername } from './username'

const EMAIL_MAX = 254

/** '' ou espaces seuls -> null ; les autres chaînes sont rognées. */
function blankToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function nullable<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToNull, schema.nullable())
}

// Exportés pour l'inscription guidée (S8 §3.3) : mêmes règles que le Profil.
export const champTitre = nullable(z.enum(TITRES, 'Titre inconnu.'))
export const champPrenom = z.string().trim().min(1, 'Le prénom est requis.').max(PRENOM_MAX, 'Le prénom est trop long.')
export const champNom = z.string().trim().min(1, 'Le nom est requis.').max(NOM_MAX, 'Le nom est trop long.')
export const champMetier = z.string().trim().min(1, 'Le métier est requis.').max(METIER_MAX, 'Le métier est trop long.')

const champTelephone = nullable(z.string().regex(E164_REGEX, 'Numéro invalide : utilisez le format international, par exemple +237600000000.'))

export const schemaVitrineCreate = z
  .object({
    titre: z.preprocess((v) => (v === undefined ? null : blankToNull(v)), z.enum(TITRES, 'Titre inconnu.').nullable()),
    prenom: champPrenom,
    nom: champNom,
    metier: champMetier,
    username: schemaUsername,
  })
  .strict()

export const schemaVitrineUpdate = z
  .object({
    titre: champTitre,
    prenom: champPrenom,
    nom: champNom,
    metier: champMetier,
    ville: nullable(z.string().max(VILLE_MAX, 'La ville est trop longue.')),
    pays: nullable(z.enum(PAYS_CODES, 'Pays inconnu.')),
    accroche: nullable(z.string().max(ACCROCHE_MAX, `L’accroche est limitée à ${ACCROCHE_MAX} caractères.`)),
    bio: nullable(z.string().max(BIO_MAX, `La présentation est limitée à ${BIO_MAX} caractères.`)),
    photoMediaId: z.uuid('Photo invalide.').nullable(),
    emailContact: nullable(z.email('Adresse email invalide.').max(EMAIL_MAX)),
    telephone: champTelephone,
    whatsapp: champTelephone,
    palette: z.enum(PALETTES, 'Palette inconnue.'),
    seoTitre: nullable(
      z
        .string()
        .min(SEO_TITRE_MIN, `Le titre sur Google doit faire au moins ${SEO_TITRE_MIN} caractères.`)
        .max(SEO_TITRE_MAX, `Le titre sur Google est limité à ${SEO_TITRE_MAX} caractères.`),
    ),
    seoDescription: nullable(
      z
        .string()
        .min(SEO_DESCRIPTION_MIN, `La description sur Google doit faire au moins ${SEO_DESCRIPTION_MIN} caractères.`)
        .max(SEO_DESCRIPTION_MAX, `La description sur Google est limitée à ${SEO_DESCRIPTION_MAX} caractères.`),
    ),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification à enregistrer.')

export const schemaUsernameChange = z.object({ username: schemaUsername }).strict()

export type VitrineCreateInput = z.infer<typeof schemaVitrineCreate>
export type VitrineUpdateInput = z.infer<typeof schemaVitrineUpdate>
export type UsernameChangeInput = z.infer<typeof schemaUsernameChange>
