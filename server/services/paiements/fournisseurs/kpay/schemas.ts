import { z } from 'zod'

// S10 (docs/specs/S10-abonnements.md §3.5) : schémas des réponses et des webhooks K-PAY. Objets TOLÉRANTS
// (`looseObject`) : les champs inconnus sont ignorés et jamais réémis. `phoneNumber` n'est volontairement pas
// lu : le numéro du payeur ne doit jamais entrer dans notre code.

const IDENTIFIANT_MAX = 100
const STATUT_MAX = 30
const EVENEMENT_MAX = 40
const CODE_ECHEC_MAX = 64
const HORODATAGE_MAX = 40
const DEVISE_LONGUEUR = 3

const identifiant = z.string().min(1).max(IDENTIFIANT_MAX)

export const schemaKpayInit = z.looseObject({
  id: identifiant,
  reference: identifiant.nullish(),
  status: z.string().max(STATUT_MAX),
  // La documentation ne garantit que `id`, `reference` et `status` : `amount` et `externalId` sont facultatifs
  // et, quand ils sont présents, contrôlés par l'adaptateur contre ce que nous avons envoyé.
  amount: z.number().nullish(),
  currency: z.string().length(DEVISE_LONGUEUR).nullish(),
  externalId: z.string().max(IDENTIFIANT_MAX).nullish(),
})

export const schemaKpayTransaction = z.looseObject({
  id: identifiant,
  reference: identifiant.nullish(),
  status: z.string().max(STATUT_MAX),
  amount: z.number(),
  netAmount: z.number().nonnegative().nullish(),
  feeAmount: z.number().nonnegative().nullish(),
  currency: z.string().length(DEVISE_LONGUEUR).nullish(),
  externalId: z.string().max(IDENTIFIANT_MAX).nullish(),
  failureReason: z.string().max(CODE_ECHEC_MAX).nullish(),
})

export const schemaKpayWebhook = z.looseObject({
  event: z.string().min(1).max(EVENEMENT_MAX),
  paymentId: identifiant,
  reference: z.string().max(IDENTIFIANT_MAX).nullish(),
  status: z.string().max(STATUT_MAX),
  amount: z.number().nonnegative(),
  externalId: z.string().max(IDENTIFIANT_MAX).nullish(),
  currency: z.string().length(DEVISE_LONGUEUR).nullish(),
  timestamp: z.string().max(HORODATAGE_MAX).nullish(),
  failureReason: z.string().max(CODE_ECHEC_MAX).nullish(),
})

export type KpayInit = z.infer<typeof schemaKpayInit>
export type KpayTransaction = z.infer<typeof schemaKpayTransaction>
export type KpayWebhook = z.infer<typeof schemaKpayWebhook>
