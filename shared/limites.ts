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
/** S8 — `terminer` (création de la vitrine) : même débit que la vérification d'adresse, compteur distinct, sans quota IA. */
export const ONBOARDING_TERMINER_LIMIT: RateLimit = USERNAME_CHECK_LIMIT
export const ONBOARDING_TERMINER_CLE_PREFIXE = 'onboarding-terminer:'
/** S9 — désabonnement (GET et POST confondus) : par IP, fail-open (le droit d'opposition reste effectif sans Redis). */
export const DESABONNEMENT_LIMITE_IP = 20
export const DESABONNEMENT_FENETRE_S = 60
export const DESABONNEMENT_LIMIT: RateLimit = { limit: DESABONNEMENT_LIMITE_IP, windowS: DESABONNEMENT_FENETRE_S }
export const DESABONNEMENT_CLE_PREFIXE = 'desabonnement:'
