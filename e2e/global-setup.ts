import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Redis } from 'ioredis'

// Les tests e2e lisent la vitrine de démonstration (dr-cabrel) : le seed est
// rejoué à chaque exécution, il est idempotent.

function lireRedisUrl(): string {
  try {
    const env = readFileSync(path.resolve(import.meta.dirname, '../.env'), 'utf-8')
    return /^REDIS_URL=(.+)$/m.exec(env)?.[1]?.trim() ?? 'redis://localhost:6379'
  } catch {
    return 'redis://localhost:6379'
  }
}

export default async function globalSetup(): Promise<void> {
  // Les compteurs de limite (`limite:*`) persistent dans Redis entre deux exécutions :
  // une relance rapprochée du parcours e2e (10 réservations / 10 min par IP) sinon échoue en 429.
  const redis = new Redis(lireRedisUrl(), { maxRetriesPerRequest: 1 })
  try {
    let curseur = '0'
    do {
      const [suivant, cles] = await redis.scan(curseur, 'MATCH', 'limite:*', 'COUNT', '200')
      curseur = suivant
      if (cles.length > 0) await redis.del(...cles)
    } while (curseur !== '0')
  } finally {
    redis.disconnect()
  }

  execFileSync('pnpm', ['db:seed'], { stdio: 'inherit' })
}
