import Redis from 'ioredis'
import { env } from '../../shared/env'

const g = globalThis as typeof globalThis & { __redisBrandself?: Redis }

function creerRedis(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    retryStrategy: (tentatives) => Math.min(tentatives * 200, 2_000),
  })
  client.on('error', (erreur: Error) => {
    console.error(`[redis] erreur de connexion : ${erreur.message}`)
  })
  return client
}

export const redis: Redis = g.__redisBrandself ?? creerRedis()

if (env.NODE_ENV !== 'production') {
  g.__redisBrandself = redis
}
