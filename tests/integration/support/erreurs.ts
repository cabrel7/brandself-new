import { DomainError } from '../../../server/exceptions/http'

export interface ErreurCapturee {
  /** Instance de DomainError : les erreurs métier prévues, jamais une erreur SQL brute. */
  estDomainError: boolean
  code: string | undefined
  status: number | undefined
  data: Record<string, unknown> | undefined
  retryAfter: number | undefined
  message: string
  brute: unknown
}

function lire(valeur: unknown, cle: string): unknown {
  return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>)[cle] : undefined
}

/** Un module de production absent (phase RED) n'est jamais « une erreur métier attendue » : on la laisse remonter telle quelle. */
const MODULE_ABSENT = /Cannot find module|Failed to load url|Failed to resolve import|ERR_MODULE_NOT_FOUND/

/** Pour les `Promise.allSettled` : relance une erreur « module absent » plutôt que de la compter comme un rejet. */
export function exigerModulesPresents(resultats: PromiseSettledResult<unknown>[]): void {
  for (const resultat of resultats) {
    if (resultat.status === 'rejected' && resultat.reason instanceof Error && MODULE_ABSENT.test(resultat.reason.message)) {
      throw resultat.reason
    }
  }
}

/** Attend le rejet d'une promesse et décrit l'erreur ; échoue si elle aboutit. */
export async function rejet(promesse: Promise<unknown>): Promise<ErreurCapturee> {
  try {
    await promesse
  } catch (erreur) {
    if (erreur instanceof Error && MODULE_ABSENT.test(erreur.message)) throw erreur
    const data = lire(erreur, 'data')
    const retryAfter = lire(erreur, 'retryAfter') ?? lire(data, 'retryAfter')
    const status = lire(erreur, 'status') ?? lire(erreur, 'statusCode')
    const code = lire(erreur, 'code')
    return {
      estDomainError: erreur instanceof DomainError,
      code: typeof code === 'string' ? code : undefined,
      status: typeof status === 'number' ? status : undefined,
      data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined,
      retryAfter: typeof retryAfter === 'number' ? retryAfter : undefined,
      message: erreur instanceof Error ? erreur.message : String(erreur),
      brute: erreur,
    }
  }
  throw new Error('La promesse devait être rejetée mais elle a abouti.')
}

/** Code SQLSTATE et nom de contrainte d'une erreur PostgreSQL (drizzle enveloppe l'erreur de pg). */
export function erreurPostgres(erreur: unknown): { sqlstate: string | undefined, contrainte: string | undefined } {
  const cause = lire(erreur, 'cause') ?? erreur
  const sqlstate = lire(cause, 'code')
  const contrainte = lire(cause, 'constraint')
  return {
    sqlstate: typeof sqlstate === 'string' ? sqlstate : undefined,
    contrainte: typeof contrainte === 'string' ? contrainte : undefined,
  }
}
