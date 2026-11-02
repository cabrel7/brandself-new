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
/** S7-bis — limite par contact (vitrine + email/téléphone hachés) : 3 messages en 24 h. */
export const MESSAGE_CONTACT_LIMIT: RateLimit = { limit: 3, windowS: 86400 }
