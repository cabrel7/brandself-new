// S10 (docs/specs/S10-abonnements.md §3.4) : constantes de l'adaptateur K-PAY. Réglables (§11).

export { KPAY_BASE_URL_DEFAUT } from '../../../../../shared/paiements'

export const KPAY_CHEMIN_INIT = '/api/v1/payments/init'
export const KPAY_CHEMIN_TRANSACTION = '/api/v1/payments/'

/** Millisecondes : délai d'un appel d'initiation (aucun nouvel essai : le résultat devient « incertain »). */
export const KPAY_DELAI_INITIATION_MS = 10_000
/** Millisecondes : délai d'une consultation (rapprochement par le worker). */
export const KPAY_DELAI_CONSULTATION_MS = 8_000

/** Nom de l'en-tête de signature des webhooks, en minuscules (comparaison insensible à la casse). */
export const KPAY_ENTETE_SIGNATURE = 'x-kpay-signature'
export const KPAY_ENTETE_CLE_API = 'X-API-Key'
export const KPAY_ENTETE_CLE_SECRETE = 'X-Secret-Key'

/** Statuts K-PAY qui n'ont pas encore de résultat final. */
export const KPAY_STATUTS_NON_TERMINAUX = ['PENDING', 'PROCESSING', 'SUBMITTED'] as const

/** Libellé du paiement chez K-PAY ; `{n}` est remplacé par le nombre de mois. */
export const KPAY_DESCRIPTION = 'Brandself — abonnement {n} mois'
export const KPAY_DESCRIPTION_MARQUEUR = '{n}'

/** Octets : taille maximale lue dans une réponse de K-PAY (les réponses réelles font moins de 2 Ko). */
export const KPAY_REPONSE_MAX_OCTETS = 65_536
/** Secondes : plafond d'un `Retry-After` pris en compte (un en-tête hostile ne bloque pas le service). */
export const KPAY_RETRY_APRES_MAX_S = 3_600

/** Taille d'une signature HMAC-SHA256 en hexadécimal (32 octets). */
export const KPAY_SIGNATURE_HEX_LONGUEUR = 64

/** Statuts HTTP significatifs des réponses K-PAY. */
export const KPAY_HTTP = {
  refuse: 400,
  nonAutorise: 401,
  interdit: 403,
  introuvable: 404,
  doublon: 409,
  limite: 429,
  erreurServeur: 500,
} as const
