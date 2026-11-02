import { ServiceUnavailableError, TooManyRequestsError } from '../exceptions/http'
import { redis } from '../utils/redis'

const KEY_PREFIX = 'limite:'

export interface LimitStatus {
  count: number
  limit: number
  allowed: boolean
  /** Secondes avant la fin de la fenêtre (toujours > 0). */
  retryAfter: number
}

/**
 * Compte un appel (fenêtre fixe : INCR + EXPIRE au premier appel). Si le compteur existe sans
 * TTL (crash entre INCR et EXPIRE), un TTL de secours est posé : jamais de blocage permanent.
 *
 * Choix : en cas de panne de Redis on laisse passer (fail-open) et on journalise, pour ne pas
 * rendre le studio inutilisable ; les limites protègent contre l'abus, pas contre la fraude.
 */
export interface LimitOptions {
  failClosed?: boolean
}

/**
 * ioredis ne rejette PAS quand une commande échoue dans un MULTI : `exec()` renvoie alors
 * `[[erreur, null], ...]` (ou `null` si la transaction est abandonnée). Une telle réponse est
 * traitée comme une panne (jamais lue comme un compteur à 0).
 */
class LimiteurCommandeError extends Error {
  constructor() {
    super('LIMITEUR_COMMANDE')
    this.name = 'LimiteurCommandeError'
  }
}

type ResultatCommande = [error: Error | null, result: unknown]

function lireResultatCommande(resultat: ResultatCommande | undefined): unknown {
  if (!resultat || resultat[0]) throw new LimiteurCommandeError()
  return resultat[1]
}

export async function hitLimit(
  key: string,
  limit: number,
  windowS: number,
  options: LimitOptions = {},
): Promise<LimitStatus> {
  const redisKey = `${KEY_PREFIX}${key}`
  try {
    const results = await redis.multi().incr(redisKey).ttl(redisKey).exec()
    if (!results) throw new LimiteurCommandeError()
    const count = Number(lireResultatCommande(results[0]))
    let ttl = Number(lireResultatCommande(results[1]))
    if (!Number.isInteger(count) || count < 1 || !Number.isFinite(ttl)) throw new LimiteurCommandeError()
    if (count === 1 || ttl < 0) {
      await redis.expire(redisKey, windowS)
      ttl = windowS
    }
    return { count, limit, allowed: count <= limit, retryAfter: ttl > 0 ? ttl : windowS }
  } catch (error) {
    console.error({ limiteur: 'redis indisponible', nom: error instanceof Error ? error.name : typeof error })
    if (options.failClosed) throw new ServiceUnavailableError('LIMITEUR_INDISPONIBLE')
    return { count: 0, limit, allowed: true, retryAfter: windowS }
  }
}

export async function enforceLimit(key: string, limit: number, windowS: number, options: LimitOptions = {}): Promise<void> {
  const status = await hitLimit(key, limit, windowS, options)
  if (!status.allowed) {
    throw new TooManyRequestsError(status.retryAfter)
  }
}
