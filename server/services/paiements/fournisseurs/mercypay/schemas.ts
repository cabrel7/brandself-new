import { z } from 'zod'

// P1 (docs/specs/P1-mercypay.md §2) : schémas des réponses et des événements Mercy Pay. Objets TOLÉRANTS (`looseObject`) :
// les champs inconnus sont ignorés et jamais réémis. Les montants sont des ENTIERS (unités mineures) : une chaîne ou un
// décimal invalide l'objet. Le numéro du payeur (`phone`, `customer`…) n'est volontairement pas lu.

const IDENTIFIANT_MAX = 100
const STATUT_MAX = 30
const TYPE_EVENEMENT_MAX = 40
const CODE_ECHEC_MAX = 64
const DEVISE_LONGUEUR = 3

const identifiant = z.string().min(1).max(IDENTIFIANT_MAX)
const montant = z.number().int().nonnegative()

/** `metadata` : on ne lit que `paiement_id` (notre UUID) ; toute autre valeur est ignorée. */
const metadata = z.looseObject({ paiement_id: z.string().max(IDENTIFIANT_MAX).nullish() }).nullish()

/** Objet paiement (`data` de la réponse de `POST /payments` et `GET /payments/{id}`, et de `payment.*`). */
const objetPaiement = z.looseObject({
  id: identifiant,
  status: z.string().max(STATUT_MAX).nullish(),
  amount: montant,
  fee_amount: montant.nullish(),
  net_amount: montant.nullish(),
  currency: z.string().length(DEVISE_LONGUEUR).nullish(),
  failure_code: z.string().max(CODE_ECHEC_MAX * 8).nullish(),
  // Date ISO 8601 dans la documentation Mercy Pay (« `created` … comme partout dans l'API ») ; un entier Unix reste toléré.
  created: z.union([z.string().max(IDENTIFIANT_MAX), z.number().int().nonnegative()]).nullish(),
  metadata,
})

export const schemaMercyReponsePaiement = z.looseObject({
  data: objetPaiement.extend({ status: z.string().max(STATUT_MAX) }),
})

/** Enveloppe d'un événement : `data` est n'importe quel objet (analysé selon `type`). */
export const schemaMercyEvenement = z.looseObject({
  id: identifiant,
  type: z.string().min(1).max(TYPE_EVENEMENT_MAX),
  livemode: z.boolean(),
  // Forme libre : un événement hors paiement (`webhook.test`…) peut porter un `data` quelconque ; l'objet paiement d'un
  // `payment.*` est validé à part (`schemaMercyPaiementEvenement`).
  data: z.unknown(),
})

/** Liste des paiements (`GET /payments`) : seuls les champs utiles au rattachement sont lus. */
export const schemaMercyListePaiements = z.looseObject({
  data: z.array(objetPaiement),
  has_more: z.boolean().nullish(),
  next_cursor: z.string().max(IDENTIFIANT_MAX).nullish(),
})

export const schemaMercyPaiementEvenement = objetPaiement

export type MercyObjetPaiement = z.infer<typeof objetPaiement>
export type MercyEvenement = z.infer<typeof schemaMercyEvenement>
