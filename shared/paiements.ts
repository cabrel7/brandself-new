// S10 (docs/specs/S10-abonnements.md §3.2) : contrats et constantes des paiements.
// Pur : aucune dépendance serveur. Les listes de fournisseurs, méthodes, statuts, traitements et
// l'exposant des devises sont recopiées (ou contrôlées) par les CHECK de la migration 0021
// (shared/db/schema.ts) : les garder synchronisées.

export const FOURNISSEURS_PAIEMENT = ['kpay'] as const
export type FournisseurPaiement = (typeof FOURNISSEURS_PAIEMENT)[number]
/** Format du nom d'un fournisseur (CHECK `paiements_fournisseur_check`) : un nouveau fournisseur n'exige aucune migration. */
export const FOURNISSEUR_FORMAT = /^[a-z0-9_-]{1,40}$/

/** `carte` est déclarée mais aucun moyen n'est actif en S10. */
export const METHODES_PAIEMENT = ['mobile_money', 'carte'] as const
export type MethodePaiement = (typeof METHODES_PAIEMENT)[number]
/** Format d'une méthode (CHECK `paiements_methode_check`). */
export const METHODE_FORMAT = /^[a-z_]{1,30}$/

export const PAIEMENT_ENVIRONNEMENTS = ['test', 'live'] as const
export type PaiementEnvironnement = (typeof PAIEMENT_ENVIRONNEMENTS)[number]

export const PAIEMENT_STATUTS = ['cree', 'en_attente', 'reussi', 'echoue', 'annule', 'expire', 'anomalie'] as const
export type PaiementStatut = (typeof PAIEMENT_STATUTS)[number]
/** Statuts non terminaux : le paiement attend encore le payeur ou le fournisseur. */
export const PAIEMENT_STATUTS_OUVERTS = ['cree', 'en_attente'] as const
export type PaiementStatutOuvert = (typeof PAIEMENT_STATUTS_OUVERTS)[number]

export const FRAIS_SUPPORTEURS = ['marchand', 'client'] as const
export type FraisSupporteur = (typeof FRAIS_SUPPORTEURS)[number]
/** Dénominateur des taux : 10 000 points de base = 100 %. */
export const POINTS_BASE_TOTAL = 10_000
/** Taux maximal accepté (CHECK `paiements_frais_taux_check`) : 50,00 %. */
export const FRAIS_TAUX_PB_MAX = 5_000

/** Nombre de décimales de l'unité mineure par devise (ISO 4217), y compris XOF (moyens des pays voisins). */
export const DEVISES_EXPOSANT: Record<string, number> = { XAF: 0, XOF: 0, EUR: 2, USD: 2 }

/** Format d'un code de devise (CHECK `paiements_devise_check`). */
export const DEVISE_FORMAT = /^[A-Z]{3}$/
/** Identifiant d'un moyen : `fournisseur:OPERATEUR` (ex. `kpay:MTN_MOMO_CMR`). */
export const MOYEN_ID_FORMAT = /^[a-z0-9_-]{1,40}:[A-Z0-9_]{2,40}$/
/** Code d'échec ou d'anomalie conservé (jamais un message brut du fournisseur). */
export const CODE_ECHEC_FORMAT = /^[A-Z0-9_]{1,64}$/

export const EVENEMENTS_NORMALISES = ['payment.completed', 'payment.failed', 'payment.cancelled'] as const
export type EvenementNom = (typeof EVENEMENTS_NORMALISES)[number]
export const EVENEMENT_SOURCES = ['webhook', 'interrogation'] as const
export type EvenementSource = (typeof EVENEMENT_SOURCES)[number]
export const TRAITEMENTS_EVENEMENT = ['applique', 'ignore', 'anomalie'] as const
export type TraitementEvenement = (typeof TRAITEMENTS_EVENEMENT)[number]
export const CODES_ANOMALIE = [
  'MONTANT_INCOHERENT',
  'ID_INCOHERENT',
  'DEVISE_INCOHERENTE',
  'PAIEMENT_INCONNU',
  'REMBOURSE',
  'EVENEMENT_NON_GERE',
] as const
export type CodeAnomalie = (typeof CODES_ANOMALIE)[number]

/** Codes d'échec posés par Brandself (les autres viennent du fournisseur, `failureReason`). */
export const CODE_ECHEC_REQUETE_REFUSEE = 'REQUETE_REFUSEE'
export const CODE_ECHEC_EXPIRE = 'EXPIRE'
export const CODE_ECHEC_DEFAUT = 'DEFAUT'

/** Messages au payeur par code d'échec du fournisseur (repli : `DEFAUT`). Vouvoiement. */
export const MESSAGES_ECHEC: Record<string, string> = {
  PAYER_NOT_FOUND: 'Ce numéro n’a pas de compte Mobile Money chez cet opérateur. Vérifiez le numéro et l’opérateur.',
  PAYMENT_NOT_APPROVED: 'Le paiement n’a pas été validé sur votre téléphone. Vous pouvez réessayer.',
  PAYER_LIMIT_REACHED: 'Le plafond de ce compte Mobile Money est atteint. Réessayez plus tard ou avec un autre numéro.',
  INSUFFICIENT_BALANCE: 'Le solde de ce compte est insuffisant.',
  TRANSACTION_ALREADY_IN_PROCESS: 'Un paiement est déjà en cours sur ce numéro. Patientez quelques minutes.',
  [CODE_ECHEC_EXPIRE]: 'Nous n’avons pas reçu la validation à temps. Si un montant a été prélevé, votre abonnement sera activé automatiquement.',
  [CODE_ECHEC_DEFAUT]: 'Le paiement n’a pas abouti. Vous pouvez réessayer.',
}

/** Message affichable pour un code d'échec ; `null` ou code inconnu donne le message par défaut. */
export function messageEchec(code: string | null): string {
  const defaut = MESSAGES_ECHEC[CODE_ECHEC_DEFAUT] ?? ''
  if (code === null) return defaut
  // `hasOwn` : un code venu du fournisseur ne doit jamais atteindre le prototype (`__proto__`, `constructor`).
  return Object.hasOwn(MESSAGES_ECHEC, code) ? (MESSAGES_ECHEC[code] ?? defaut) : defaut
}

// --- Suivi côté navigateur (le navigateur interroge NOTRE API, jamais le fournisseur) ---

/** Millisecondes entre deux lectures du statut d'un paiement. */
export const PAIEMENT_SUIVI_INTERVALLE_MS = 5_000
/** Millisecondes : durée maximale du suivi à l'écran (3 minutes). */
export const PAIEMENT_SUIVI_MAX_MS = 180_000
/** Secondes : délai avant qu'une nouvelle initiation soit acceptée alors qu'un paiement est ouvert. */
export const PAIEMENT_RELANCE_APRES_S = 60

// --- Numéro du payeur : jamais stocké en clair ---

export const TELEPHONE_MASQUE_CHIFFRES_VISIBLES = 2
export const TELEPHONE_MASQUE_CARACTERE = '•'
/** Paramètre `info` de la dérivation HKDF-SHA256 de la clé de l'empreinte du numéro. */
export const TELEPHONE_EMPREINTE_HKDF_INFO = 'brandself-telephone-paiement-v1'

// --- K-PAY : clés et adresse (validées dans shared/env.ts) ---

/** Adresse par défaut de l'API K-PAY (HTTPS). */
export const KPAY_BASE_URL_DEFAUT = 'https://admin.kpay.site'
/** Seuls hôtes autorisés en HTTP clair, hors production (faux serveur K-PAY des tests). */
export const KPAY_HOTES_HTTP_AUTORISES: readonly string[] = ['127.0.0.1', 'localhost']
export const KPAY_CLE_PREFIXE_TEST = 'kpay_test_'
export const KPAY_CLE_PREFIXE_LIVE = 'kpay_live_'
/** `kpay_test_…` ou `kpay_live_…`, suivi de caractères sûrs. */
export const KPAY_CLE_API_FORMAT = /^kpay_(?:test|live)_[A-Za-z0-9_-]+$/
/** Clé secrète : 64 caractères hexadécimaux. */
export const KPAY_CLE_SECRETE_FORMAT = /^[0-9a-fA-F]{64}$/
/** Caractères : longueur minimale du secret de signature des webhooks. */
export const KPAY_WEBHOOK_SECRET_LONGUEUR_MIN = 16
