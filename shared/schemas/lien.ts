import { z } from 'zod'
import { LISTE_REORDER_MAX } from '../listes'
import {
  LIEN_ADRESSE_MAX,
  LIEN_LIBELLE_MAX,
  LIEN_NUMERO_CHIFFRES_MAX,
  LIEN_NUMERO_CHIFFRES_MIN,
  LIEN_RESEAUX,
  LIEN_URL_MAX,
  LIEN_VITRINE_PAGES,
} from '../liens'

// Un lien est validé PAR TYPE (S6) : chaque type a ses propres champs, le serveur
// construit l'URL finale (jamais `javascript:`). Les champs hors du type du lien
// sont refusés par le service (cohérence type/champs).

const champLibelle = z.string().trim().min(1, 'Le libellé est requis.').max(LIEN_LIBELLE_MAX)
const champUrl = z
  .string()
  .trim()
  .min(1, 'Le lien est requis.')
  .max(LIEN_URL_MAX)
  .url('Lien invalide.')
  .refine((url) => url.startsWith('https://'), 'Seuls les liens https sont acceptés.')

/** Chiffres du numéro seulement : entre 6 et 15 (recommandation E.164). */
const champNumero = z
  .string()
  .trim()
  .min(1, 'Le numéro est requis.')
  .max(30)
  .regex(/^\+?[0-9 ()\-.]+$/, 'Numéro invalide.')
  .refine(
    (numero) => {
      const chiffres = numero.replace(/[^0-9]/g, '')
      return chiffres.length >= LIEN_NUMERO_CHIFFRES_MIN && chiffres.length <= LIEN_NUMERO_CHIFFRES_MAX
    },
    `Le numéro doit compter entre ${LIEN_NUMERO_CHIFFRES_MIN} et ${LIEN_NUMERO_CHIFFRES_MAX} chiffres.`,
  )

const champAdresse = z
  .string()
  .trim()
  .min(1, 'L’adresse courriel est requise.')
  .max(LIEN_ADRESSE_MAX)
  .email('Adresse courriel invalide.')

const champPlateforme = z.enum(LIEN_RESEAUX.map((reseau) => reseau.id) as [string, ...string[]], {
  message: 'Choisissez un réseau social dans la liste.',
})

const champPage = z.enum(LIEN_VITRINE_PAGES.map((page) => page.id) as [string, ...string[]], {
  message: 'Choisissez une page de votre vitrine.',
})

// z.strictObject : un champ hors du type choisi est refusé (jamais retiré en silence).
export const schemaLienCreate = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('libre'), libelle: champLibelle, url: champUrl, actif: z.boolean().default(true) }),
  z.strictObject({ type: z.literal('whatsapp'), libelle: champLibelle, numero: champNumero, actif: z.boolean().default(true) }),
  z.strictObject({
    type: z.literal('reseau'),
    libelle: champLibelle,
    plateforme: champPlateforme,
    url: champUrl,
    actif: z.boolean().default(true),
  }),
  z.strictObject({ type: z.literal('email'), libelle: champLibelle, adresse: champAdresse, actif: z.boolean().default(true) }),
  z.strictObject({ type: z.literal('telephone'), libelle: champLibelle, numero: champNumero, actif: z.boolean().default(true) }),
  z.strictObject({ type: z.literal('vitrine'), libelle: champLibelle, page: champPage, actif: z.boolean().default(true) }),
])

/**
 * Mise à jour : patch partiel. Le type est fixé à la création et ne change jamais ;
 * le service refuse les champs hors du type du lien (cohérence type/champs) et
 * reconstruit l'URL pour les types construits (whatsapp, email, téléphone, vitrine).
 */
export const schemaLienUpdate = z.object({
  libelle: champLibelle.optional(),
  actif: z.boolean().optional(),
  url: champUrl.optional(),
  numero: champNumero.optional(),
  adresse: champAdresse.optional(),
  plateforme: champPlateforme.optional(),
  page: champPage.optional(),
})

export const schemaLienReorder = z.object({
  ids: z.array(z.string().uuid()).min(1, 'La liste des identifiants est requise.').max(LISTE_REORDER_MAX, 'Trop d’identifiants.'),
})

export type LienCreateInput = z.infer<typeof schemaLienCreate>
export type LienUpdateInput = z.infer<typeof schemaLienUpdate>
export type LienReorderInput = z.infer<typeof schemaLienReorder>
