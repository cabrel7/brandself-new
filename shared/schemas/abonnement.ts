import { z } from 'zod'
import { PRIX_MAX_MINOR } from '../devises'
import { DEVISE_FORMAT, FOURNISSEUR_FORMAT, MOYEN_ID_FORMAT } from '../paiements'
import { PERIODES_MOIS } from '../plans'

// S10 (docs/specs/S10-abonnements.md §3.5) : schémas stricts des routes d'abonnement et de paiement.

/** Caractères : bornes de la saisie d'un numéro de téléphone (avant normalisation par le service). */
export const TELEPHONE_SAISIE_LONGUEUR_MIN = 8
export const TELEPHONE_SAISIE_LONGUEUR_MAX = 20
const TELEPHONE_SAISIE_FORMAT = /^\+?[0-9 ]+$/

const schemaDevise = z.string().regex(DEVISE_FORMAT, 'Devise invalide.')

export const schemaPaiementInitier = z.strictObject({
  periodeMois: z.literal([...PERIODES_MOIS], 'Durée invalide.'),
  devise: schemaDevise,
  moyen: z.string().regex(MOYEN_ID_FORMAT, 'Moyen de paiement invalide.'),
  telephone: z
    .string()
    .trim()
    .min(TELEPHONE_SAISIE_LONGUEUR_MIN, 'Numéro de téléphone invalide.')
    .max(TELEPHONE_SAISIE_LONGUEUR_MAX, 'Numéro de téléphone invalide.')
    .regex(TELEPHONE_SAISIE_FORMAT, 'Numéro de téléphone invalide.'),
  // A5 (D-A5-07) : montant TTC que le client a sous les yeux (unité mineure de `devise`, frais compris). Le serveur
  // recalcule le prix et répond 409 `PRIX_CHANGE` (avec le montant actuel) si l'écart existe : jamais de paiement au
  // prix que le client n'a pas vu. Obligatoire : un client qui ne l'envoie pas est refusé (400 `VALIDATION`).
  prixAffiche: z
    .number('Prix invalide.')
    .int('Prix invalide.')
    .min(1, 'Prix invalide.')
    .max(PRIX_MAX_MINOR, 'Prix invalide.'),
})

export const schemaPaiementId = z.strictObject({ id: z.uuid('Identifiant invalide.') })

export const schemaTarifsQuery = z.strictObject({ devise: schemaDevise.optional() })

export const schemaWebhookFournisseur = z.strictObject({
  fournisseur: z.string().regex(FOURNISSEUR_FORMAT, 'Fournisseur invalide.'),
})

export type PaiementInitierInput = z.infer<typeof schemaPaiementInitier>
export type PaiementIdInput = z.infer<typeof schemaPaiementId>
export type TarifsQueryInput = z.infer<typeof schemaTarifsQuery>
export type WebhookFournisseurInput = z.infer<typeof schemaWebhookFournisseur>
