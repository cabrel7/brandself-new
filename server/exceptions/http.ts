export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Introuvable') {
    super(message, 404)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Interdit') {
    super(message, 403)
    this.name = 'ForbiddenError'
  }
}
