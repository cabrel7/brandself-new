export interface RateLimit {
  limit: number
  windowS: number
}

export const USERNAME_CHECK_LIMIT: RateLimit = { limit: 30, windowS: 60 }
export const MEDIA_UPLOAD_LIMIT: RateLimit = { limit: 30, windowS: 3600 }
/** Enregistrement d'un clic : trafic public, par adresse IP (limité en débit, ne bloque jamais la navigation). */
export const LIEN_CLIC_LIMIT: RateLimit = { limit: 60, windowS: 60 }
/** Formulaires publics avec PII : limite stricte par IP, Redis indisponible = écriture refusée. */
export const RESERVATION_PUBLIC_LIMIT: RateLimit = { limit: 10, windowS: 600 }
export const RESERVATION_CONTACT_LIMIT: RateLimit = { limit: 3, windowS: 86400 }
export const DEMANDE_PUBLIC_LIMIT: RateLimit = { limit: 10, windowS: 600 }
/** S7-bis — formulaire public de contact : limite par IP (fenêtre courte). */
export const MESSAGE_PUBLIC_LIMIT: RateLimit = { limit: 5, windowS: 600 }
/** S7-bis — plafond par vitrine : empêche le bombardement du professionnel avec des emails changeants. */
export const MESSAGE_VITRINE_LIMIT: RateLimit = { limit: 30, windowS: 3600 }
/** S7-bis — limite par contact (vitrine + email/téléphone hachés) : 3 messages en 24 h. */
export const MESSAGE_CONTACT_LIMIT: RateLimit = { limit: 3, windowS: 86400 }
/** S8 — demandes IA (generer + ameliorer confondus) : 10 par heure et par utilisateur, fail-closed (429). */
export const IA_UTILISATEUR_LIMIT: RateLimit = { limit: 10, windowS: 3600 }
/** S8 — plafond global de coût : au-delà, repli sans appel au fournisseur (jamais d'erreur bloquante). */
export const IA_GLOBAL_LIMIT: RateLimit = { limit: 2000, windowS: 86400 }
/** S8 — clés du limiteur (préfixe `limite:` ajouté par le limiteur). */
export const IA_LIMITE_CLE_UTILISATEUR_PREFIXE = 'ia:'
export const IA_LIMITE_CLE_GLOBALE = 'ia-global'
/**
 * Décision #24 — régénération du SEO d'UNE vitrine : 5 par 24 h (compteur `seo-ia:{vitrineId}`). Jamais le compteur
 * par utilisateur (`ia:{userId}`) ni le quota mensuel : le SEO de fond n'est pas une demande de l'utilisateur. Le
 * plafond global de coût (`IA_LIMITE_CLE_GLOBALE`) s'applique en revanche.
 */
export const SEO_IA_VITRINE_LIMIT: RateLimit = { limit: 5, windowS: 86400 }
export const SEO_IA_LIMITE_CLE_PREFIXE = 'seo-ia:'
/** S11 — enregistrement d'une vue publique, par IP, fail-open (la navigation n'est jamais interrompue). */
export const VUE_PUBLIC_LIMIT: RateLimit = { limit: 60, windowS: 60 }
export const VUE_LIMITE_CLE_PREFIXE = 'vue:'
/** S8 — `terminer` (création de la vitrine) : même débit que la vérification d'adresse, compteur distinct, sans quota IA. */
export const ONBOARDING_TERMINER_LIMIT: RateLimit = USERNAME_CHECK_LIMIT
export const ONBOARDING_TERMINER_CLE_PREFIXE = 'onboarding-terminer:'
/**
 * S9 — désabonnement, par IP, fail-open (le droit d'opposition reste effectif sans Redis). Budgets distincts :
 * l'aperçu (GET) est large car les scanners de liens des messageries l'ouvrent ; l'action (POST) reste serrée.
 */
export const DESABONNEMENT_APERCU_LIMIT: RateLimit = { limit: 60, windowS: 60 }
export const DESABONNEMENT_ACTION_LIMIT: RateLimit = { limit: 20, windowS: 60 }
export const DESABONNEMENT_OPERATIONS = ['apercu', 'action'] as const
export type DesabonnementOperation = (typeof DESABONNEMENT_OPERATIONS)[number]
export const DESABONNEMENT_CLE_PREFIXE = 'desabonnement:'

// S10 (docs/specs/S10-abonnements.md §1 #110, #112, #117) : paiement. Toutes ces valeurs sont réglables (§11).
/** Initiation d'un paiement, par utilisateur : 5 par 15 minutes, fail-closed (503 si Redis est indisponible). */
export const PAIEMENT_INIT_LIMIT_UTILISATEUR: RateLimit = { limit: 5, windowS: 900 }
/** Initiation vers un même numéro (empreinte HMAC), tous comptes confondus : protège un tiers du spam USSD. */
export const PAIEMENT_INIT_LIMIT_NUMERO: RateLimit = { limit: 3, windowS: 900 }
/** Lecture du statut d'un paiement par le navigateur (notre API, jamais le fournisseur). */
export const PAIEMENT_SUIVI_LIMIT: RateLimit = { limit: 60, windowS: 60 }
export const PAIEMENT_LIMITE_CLE_UTILISATEUR_PREFIXE = 'paiement-init:'
export const PAIEMENT_LIMITE_CLE_NUMERO_PREFIXE = 'paiement-numero:'
export const PAIEMENT_LIMITE_CLE_SUIVI_PREFIXE = 'paiement-suivi:'
/** Paiements `cree` ou `en_attente` simultanés au plus, par utilisateur. */
export const PAIEMENTS_OUVERTS_MAX = 2
/** K-PAY plafonne à 100 requêtes par minute pour toute l'application : on s'en tient à 60 (initiation + vérification). */
export const KPAY_APPELS_MAX_PAR_MINUTE = 60
export const KPAY_APPELS_FENETRE_S = 60
/** Clé Redis du compteur global d'appels K-PAY (fail-closed). */
export const KPAY_APPELS_CLE = 'kpay:appels'
/** Octets : taille maximale du corps d'un webhook (K-PAY envoie moins de 1 Ko). */
export const WEBHOOK_CORPS_MAX_OCTETS = 16_384

// A3 (docs/specs/A3-abonnements-paiements.md §2, §5) : administration des paiements. Valeurs réglables, jamais écrites en dur ailleurs.
/** D-A3-04 : revérifications admin auprès de K-PAY, par administrateur (elles consomment le budget K-PAY partagé). */
export const ADMIN_REVERIFICATION_LIMIT: RateLimit = { limit: 10, windowS: 60 }
export const ADMIN_REVERIFICATION_CLE_PREFIXE = 'admin-reverif:'
/** D-A3-03 : minutes pendant lesquelles une revérification « non réussi » autorise le marquage manuel. */
export const ADMIN_REVERIFICATION_VALIDITE_MIN = 30
/** D-A3-05 : jours de conservation du compteur des webhooks refusés. */
export const WEBHOOKS_REFUSES_RETENTION_JOURS = 90
/** D-A3-13 : seuils d'alerte. Un paiement ouvert depuis PLUS de N minutes ; PLUS de N webhooks refusés sur 1 heure. */
export const ADMIN_ALERTE_PAIEMENT_OUVERT_MIN = 60
export const ADMIN_ALERTE_WEBHOOKS_REFUSES_SEUIL = 10
/** Jours : fenêtre de recherche des encaissements tardifs ignorés (`STATUT_FINAL`). */
export const ADMIN_ALERTE_TARDIFS_JOURS = 7
/** Identifiants d'incohérence listés au plus, par requête de détection. */
export const ADMIN_ALERTE_INCOHERENCES_MAX = 20
/** D-A3-14 : onglets d'abonnements. Renouvellement : (now, now + 7 j]. Grâce : `ABONNEMENT_GRACE_JOURS` (plans.ts). Expirés : 30 j de plus. */
export const ADMIN_ABONNEMENT_RENOUVELLEMENT_JOURS = 7
export const ADMIN_ABONNEMENT_EXPIRES_FENETRE_JOURS = 30
/** D-A3-07 : un rappel manuel par abonnement et par fenêtre de N heures. */
export const ADMIN_RAPPEL_INTERVALLE_HEURES = 24
/** D-A3-09 : lignes d'export au plus (422 `EXPORT_TROP_GRAND` au-delà). */
export const ADMIN_EXPORT_LIGNES_MAX = 5_000
/** Revenus : mois glissants de la répartition par durée d'abonnement. */
export const ADMIN_REVENUS_REPARTITION_MOIS = 12
