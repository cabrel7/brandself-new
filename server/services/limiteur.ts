import { TooManyRequestsError } from '../exceptions/http'
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
export async function hitLimit(key: string, limit: number, windowS: number): Promise<LimitStatus> {
  const redisKey = `${KEY_PREFIX}${key}`
  try {
    const results = await redis.multi().incr(redisKey).ttl(redisKey).exec()
    const count = Number(results?.[0]?.[1] ?? 0)
    let ttl = Number(results?.[1]?.[1] ?? -1)
    if (count === 1 || ttl < 0) {
      await redis.expire(redisKey, windowS)
      ttl = windowS
    }
    return { count, limit, allowed: count <= limit, retryAfter: ttl > 0 ? ttl : windowS }
  } catch (error) {
    console.error({ limiteur: 'redis indisponible', nom: error instanceof Error ? error.name : typeof error })
    return { count: 0, limit, allowed: true, retryAfter: windowS }
  }
}

export async function enforceLimit(key: string, limit: number, windowS: number): Promise<void> {
  const status = await hitLimit(key, limit, windowS)
  if (!status.allowed) {
    throw new TooManyRequestsError(status.retryAfter)
  }
}
