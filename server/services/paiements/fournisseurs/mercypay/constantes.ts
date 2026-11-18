// P1 (docs/specs/P1-mercypay.md §2, §4.2) : constantes de l'adaptateur Mercy Pay. Réglables.

import { MARQUE } from '../../../../../shared/brand'
import { CODE_ECHEC_EXPIRE } from '../../../../../shared/paiements'

export { MERCY_PAY_BASE_URL_DEFAUT } from '../../../../../shared/paiements'

/** Chemins relatifs à `MERCY_PAY_BASE_URL` (qui porte déjà `/api/v1`). */
export const MERCY_CHEMIN_PAIEMENTS = '/payments'

/** Millisecondes : délai d'un appel d'initiation (aucun nouvel essai ici : le résultat devient « incertain »). */
export const MERCY_DELAI_INITIATION_MS = 10_000
/** Millisecondes : délai d'une consultation (rapprochement par le worker). */
export const MERCY_DELAI_CONSULTATION_MS = 8_000
/** Recherche d'un paiement par notre identifiant (`GET /payments`, 100 objets par page maximum selon la documentation). */
export const MERCY_RECHERCHE_LIMITE = 100
export const MERCY_RECHERCHE_PAGES_MAX = 3

/** Nom de l'en-tête de signature des webhooks, en minuscules (comparaison insensible à la casse). */
export const MERCY_ENTETE_SIGNATURE = 'mercypay-signature'
export const MERCY_ENTETE_IDEMPOTENCE = 'Idempotency-Key'
/** Secondes : tolérance symétrique (passé et futur) de l'horodatage `t` d'une signature (documentation Mercy Pay). */
export const MERCY_TOLERANCE_SIGNATURE_S = 300
/** Schéma de signature accepté ; les autres (`v0`, `v2`…) sont ignorés. */
export const MERCY_SIGNATURE_SCHEMA = 'v1'
/** Taille d'une signature HMAC-SHA256 en hexadécimal (32 octets). */
export const MERCY_SIGNATURE_HEX_LONGUEUR = 64
/** Un `t` est un entier de secondes : 15 chiffres au plus (bien au-delà de l'an 10 000). */
export const MERCY_SIGNATURE_T_CHIFFRES_MAX = 15
/** Caractères : taille maximale de l'en-tête de signature pris en compte (rotation : 2 ou 3 `v1`). */
export const MERCY_SIGNATURE_ENTETE_MAX = 1_024
/** Nombre maximal de `v1` examinés (borne le travail sur un en-tête hostile). */
export const MERCY_SIGNATURE_V1_MAX = 5

/** Octets : taille maximale lue dans une réponse de Mercy Pay. */
export const MERCY_REPONSE_MAX_OCTETS = 65_536
/** Secondes : plafond d'un `Retry-After` pris en compte (un en-tête hostile ne bloque pas le service). */
export const MERCY_RETRY_APRES_MAX_S = 3_600

/** Moyen de paiement transmis (P1 : mobile money seulement). */
export const MERCY_METHODE_MOBILE_MONEY = 'mobile_money'
/** Clé de `metadata` portant NOTRE identifiant de paiement (UUID). */
export const MERCY_METADATA_PAIEMENT_ID = 'paiement_id'
/** Caractères : longueur maximale de la description (documentation Mercy Pay). */
export const MERCY_DESCRIPTION_MAX = 500
/** Opérateur `<NOM>_<PAYS ISO alpha-3>` : le pays est le dernier segment (`MTN_MOMO_CMR` -> `CMR`). */
export const MERCY_OPERATEUR_PAYS_FORMAT = /^[A-Z0-9_]+_([A-Z]{3})$/
/** Numéro transmis : chiffres seulement, indicatif inclus (espaces et `+` retirés avant). */
export const MERCY_TELEPHONE_FORMAT = /^\d{8,15}$/

/** Statuts de paiement Mercy Pay (`data.status`). Tout autre statut est traité comme non terminal. */
export const MERCY_STATUTS = {
  enAttente: 'pending',
  reussi: 'succeeded',
  echoue: 'failed',
  rembourse: 'refunded',
} as const

/** Types d'événements de paiement gérés. */
export const MERCY_EVENEMENT_PREFIXE_PAIEMENT = 'payment.'
export const MERCY_EVENEMENTS = {
  reussi: 'payment.succeeded',
  echoue: 'payment.failed',
  rembourse: 'payment.refunded',
} as const

/**
 * `failure_code` Mercy Pay -> notre code d'échec (jamais le texte du fournisseur). Seuls les codes qui n'ont pas la même
 * forme chez nous y figurent ; les autres sont mis en MAJUSCULES (`insufficient_balance` -> `INSUFFICIENT_BALANCE`) et
 * retombent sur le message `DEFAUT` s'ils n'ont pas de message dédié (`messageEchec`).
 */
export const MERCY_CODES_ECHEC: Readonly<Record<string, string>> = {
  // `transaction_expired` : code réel de la documentation (« Le payeur n'a pas confirmé à temps »). `expired` est le STATUT
  // d'un paiement carte non terminé ; il est gardé par tolérance.
  transaction_expired: CODE_ECHEC_EXPIRE,
  expired: CODE_ECHEC_EXPIRE,
}
/** Forme d'un `failure_code` Mercy Pay accepté avant mise en majuscules. */
export const MERCY_CODE_ECHEC_FORMAT = /^[a-z0-9_]{1,64}$/

/** Libellé du paiement chez Mercy Pay ; `{n}` est remplacé par le nombre de mois. ASCII : les 22 premiers caractères sont le message de l'opérateur. */
export const MERCY_DESCRIPTION = `${MARQUE.nom} - abonnement {n} mois`
export const MERCY_DESCRIPTION_MARQUEUR = '{n}'

/** Statuts HTTP significatifs des réponses Mercy Pay. */
export const MERCY_HTTP = {
  requeteInvalide: 400,
  nonAutorise: 401,
  interdit: 403,
  introuvable: 404,
  doublon: 409,
  nonTraitable: 422,
  limite: 429,
  erreurServeur: 500,
} as const
