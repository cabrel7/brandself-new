import { ERROR_STATUS } from '../../shared/erreurs'
import type { ErrorCode } from '../../shared/erreurs'
import { VEDETTE_MAX } from '../../shared/services'

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
  VEDETTE_COMPLETE: `Vous avez déjà ${VEDETTE_MAX} services en vedette. Retirez-en un pour mettre celui-ci en avant.`,
  ORDRE_INVALIDE: 'L’ordre envoyé ne correspond plus à vos services. Rechargez la page et réessayez.',
  PAIEMENT_EN_LIGNE_INDISPONIBLE: 'Le paiement en ligne n’est pas encore disponible. Choisissez le règlement sur place.',
  TROP_DE_REQUETES: 'Trop de tentatives. Réessayez dans quelques instants.',
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

export class TooManyRequestsError extends DomainError {
  constructor(public readonly retryAfter: number) {
    super('TROP_DE_REQUETES', ERROR_MESSAGES.TROP_DE_REQUETES, 429, { retryAfter })
  }
}
