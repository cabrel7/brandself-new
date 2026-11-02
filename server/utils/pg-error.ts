export const PG_UNIQUE_VIOLATION = '23505'
export const PG_FOREIGN_KEY_VIOLATION = '23503'
export const PG_EXCLUSION_VIOLATION = '23P01'
export const PG_RESTRICT_VIOLATION = '23001'

export interface PgErrorInfo {
  code: string | undefined
  constraint: string | undefined
}

function read(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/**
 * SQLSTATE et nom de contrainte d'une erreur PostgreSQL. Drizzle enveloppe l'erreur du
 * driver `pg` dans `cause` : on lit la cause si elle existe, sinon l'erreur elle-même.
 */
export function readPgError(error: unknown): PgErrorInfo {
  const source = read(error, 'cause') ?? error
  const code = read(source, 'code')
  const constraint = read(source, 'constraint')
  return {
    code: typeof code === 'string' ? code : undefined,
    constraint: typeof constraint === 'string' ? constraint : undefined,
  }
}
