import { ERROR_STATUS } from '../../shared/erreurs'
import type { ErrorCode } from '../../shared/erreurs'
import { VEDETTE_MAX } from '../../shared/listes'

/**
 * Messages affichables (français, vouvoiement). Les services lèvent des erreurs métier
 * sans connaître HTTP ; `defineApiHandler` (server/utils/api.ts) les traduit en H3Error.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION: 'Certaines informations sont invalides. Vérifiez les champs signalés.',
  FICHIER_MANQUANT: 'Aucun fichier n’a été reçu. Choisissez une photo et réessayez.',
  CONFIRMATION_INVALIDE: 'La phrase de confirmation est incorrecte.',
  SESSION_TROP_ANCIENNE: 'Pour votre sécurité, reconnectez-vous avant de poursuivre.',
  VITRINE_INTROUVABLE: 'Cette vitrine n’existe pas ou n’est plus publiée.',
  MEDIA_INTROUVABLE: 'Cette image est introuvable.',
  APPAREIL_INTROUVABLE: 'Cet appareil est introuvable.',
  VITRINE_EXISTE: 'Vous avez déjà une vitrine.',
  USERNAME_PRIS: 'Cette adresse est déjà utilisée. Choisissez-en une autre.',
  TAILLE_REQUISE: 'La taille du fichier doit être indiquée.',
  FICHIER_TROP_LOURD: 'Ce fichier est trop lourd. La taille maximale est de 10 Mo.',
  TYPE_NON_SUPPORTE: 'Ce format n’est pas pris en charge. Utilisez une image JPEG, PNG ou WebP.',
  IMAGE_ILLISIBLE: 'Cette image est illisible. Essayez avec un autre fichier.',
  IMAGE_TROP_GRANDE: 'Cette image est trop grande. Réduisez ses dimensions et réessayez.',
  MEDIA_INVALIDE: 'Cette image n’est pas utilisable.',
  PUBLICATION_INCOMPLETE: 'Complétez votre vitrine avant de la publier.',
  SESSION_ACTUELLE: 'Vous ne pouvez pas déconnecter l’appareil que vous utilisez.',
  SERVICE_INTROUVABLE: 'Ce service est introuvable.',
  REALISATION_INTROUVABLE: 'Cette réalisation est introuvable.',
  TEMOINAGE_INTROUVABLE: 'Ce témoignage est introuvable.',
  LIEN_INTROUVABLE: 'Ce lien est introuvable.',
  LIEN_COHERENCE: 'Ce type de lien n’accepte pas ces informations.',
  DISPONIBILITES_INVALIDES: 'Ces disponibilités se chevauchent ou sont invalides.',
  INDISPONIBILITE_INTROUVABLE: 'Cette indisponibilité est introuvable.',
  INDISPONIBILITE_EXISTANTE: 'Cette date est déjà indisponible.',
  RESERVATION_INTROUVABLE: 'Cette réservation est introuvable.',
  MESSAGE_INTROUVABLE: 'Ce message est introuvable.',
  CRENEAU_INDISPONIBLE: 'Ce créneau n’est pas disponible.',
  CRENEAU_PRIS: 'Ce créneau vient d’être réservé. Choisissez-en un autre.',
  TRANSITION_RESERVATION_INVALIDE: 'Cette réservation ne peut pas passer à ce statut.',
  CONFIRMATION_RESERVATION_INVALIDE: 'Ce lien de confirmation est invalide.',
  CONFIRMATION_EXPIREE: 'Ce lien de confirmation a expiré.',
  DEMANDE_NON_AUTORISEE: 'Ce service doit être réservé avec un créneau.',
  DEMANDE_INTROUVABLE: 'Cette demande est introuvable.',
  TRANSITION_DEMANDE_INVALIDE: 'Cette demande ne peut pas passer à ce statut.',
  SERVICE_UTILISE: 'Ce service est lié à une réservation ou une demande. Masquez-le plutôt que de le supprimer.',
  VEDETTE_COMPLETE: `Vous avez déjà ${VEDETTE_MAX} éléments en vedette. Retirez-en un pour en mettre un autre en avant.`,
  ORDRE_INVALIDE: 'L’ordre envoyé n’est plus à jour. Rechargez la page et réessayez.',
  PAIEMENT_EN_LIGNE_INDISPONIBLE: 'Le paiement en ligne n’est pas encore disponible. Choisissez le règlement sur place.',
  ONBOARDING_INCOMPLET: 'Il manque encore une étape avant de continuer.',
  ONBOARDING_TERMINE: 'Votre vitrine est déjà créée. Retrouvez-la dans votre studio.',
  PROPOSITION_INDISPONIBLE: 'La proposition n’est pas encore prête. Patientez un instant.',
  GENERATION_INTROUVABLE: 'Cette proposition est introuvable.',
  JETON_INVALIDE: 'Ce lien n’est pas valide.',
  JETON_EXPIRE: 'Ce lien a expiré. Vous pouvez gérer vos e-mails depuis votre compte.',
  VITRINE_NON_PUBLIEE: 'Publiez votre vitrine avant de la partager.',
  ETAPE_INCONNUE: 'Cette étape n’existe pas.',
  LIMITE_PLAN_ATTEINTE: 'Vous avez atteint la limite du plan gratuit.',
  RESERVATIONS_INDISPONIBLES: 'Ce professionnel ne prend plus de nouvelle réservation en ligne ce mois-ci. Vous pouvez le contacter directement.',
  PAIEMENT_INDISPONIBLE: 'Le paiement en ligne n’est pas disponible pour le moment.',
  FOURNISSEUR_INDISPONIBLE: 'L’opérateur ne répond pas. Réessayez dans un instant.',
  MOYEN_PAIEMENT_INVALIDE: 'Ce moyen de paiement n’est pas disponible.',
  DEVISE_NON_PAYABLE: 'Cette devise n’est pas encore acceptée.',
  TELEPHONE_INVALIDE: 'Ce numéro ne correspond pas à l’opérateur choisi.',
  PAIEMENT_EN_COURS: 'Un paiement est déjà en cours. Validez-le sur votre téléphone.',
  PAIEMENT_REFUSE: 'L’opérateur a refusé la demande. Vérifiez le numéro.',
  PAIEMENT_INTROUVABLE: 'Ce paiement est introuvable.',
  // Webhooks : corps minimal, aucun détail sur la cause (aucun oracle pour un appelant non authentifié).
  SIGNATURE_INVALIDE: 'Signature invalide.',
  FOURNISSEUR_INCONNU: 'Ressource introuvable.',
  WEBHOOK_NON_CONFIGURE: 'Service indisponible.',
  CORPS_TROP_GROS: 'Corps de requête trop volumineux.',
  CORPS_ILLISIBLE: 'Corps de requête illisible.',
  TROP_DE_REQUETES: 'Trop de tentatives. Réessayez dans quelques instants.',
  LIMITEUR_INDISPONIBLE: 'Le formulaire est temporairement indisponible. Réessayez dans quelques instants.',
  ERREUR_INTERNE: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',
}

export type ErrorExtra = Record<string, unknown>

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly data?: ErrorExtra,
  ) {
    super(message)
    this.name = new.target.name
  }
}

function fromCode(code: ErrorCode): { message: string, status: number } {
  return { message: ERROR_MESSAGES[code], status: ERROR_STATUS[code] }
}

export class ValidationError extends DomainError {
  constructor(champs: Record<string, string[] | undefined>, message: string = ERROR_MESSAGES.VALIDATION) {
    super('VALIDATION', message, ERROR_STATUS.VALIDATION, { champs })
  }
}

export class NotFoundError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 404, data)
  }
}

export class ConflictError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 409, data)
  }
}

export class UnprocessableError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 422, data)
  }
}

export class ForbiddenError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 403, data)
  }
}

export class BadRequestError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 400, data)
  }
}

export class LengthRequiredError extends DomainError {
  constructor() {
    super('TAILLE_REQUISE', ERROR_MESSAGES.TAILLE_REQUISE, 411)
  }
}

export class PayloadTooLargeError extends DomainError {
  constructor() {
    super('FICHIER_TROP_LOURD', ERROR_MESSAGES.FICHIER_TROP_LOURD, 413)
  }
}

export class UnsupportedMediaTypeError extends DomainError {
  constructor() {
    super('TYPE_NON_SUPPORTE', ERROR_MESSAGES.TYPE_NON_SUPPORTE, 415)
  }
}

/** 401 : appelant non authentifié par signature (webhooks). Le message reste minimal. */
export class UnauthorizedError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 401, data)
  }
}

/** 413 avec un code métier (le `PayloadTooLargeError` historique est réservé aux fichiers). */
export class ContentTooLargeError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 413, data)
  }
}

export class TooManyRequestsError extends DomainError {
  constructor(public readonly retryAfter: number) {
    super('TROP_DE_REQUETES', ERROR_MESSAGES.TROP_DE_REQUETES, 429, { retryAfter })
  }
}

export class GoneError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 410, data)
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(code: ErrorCode, data?: ErrorExtra) {
    super(code, fromCode(code).message, 503, data)
  }
}
