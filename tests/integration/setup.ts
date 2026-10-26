import { mkdir, rm } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import { assertBaseDeTest, assertRedisDeTest } from './support/garde-base'

const PREFIXE_LIMITES = 'limite:'

function mediasDir(): string {
  const dossier = process.env.MEDIAS_DIR
  if (!dossier) {
    throw new Error('MEDIAS_DIR doit être défini pour les tests d’intégration.')
  }
  return dossier
}

async function supprimerCles(motif: string): Promise<void> {
  const cles = await redis.keys(motif)
  if (cles.length > 0) {
    await redis.del(...cles)
  }
}

beforeAll(() => {
  // Ceinture et bretelles : le globalSetup a déjà refusé, mais on ne vide jamais une autre base.
  assertBaseDeTest(process.env.DATABASE_URL)
  assertRedisDeTest(process.env.REDIS_URL)
})

// Chaque test part d'un état vide : tables (CASCADE depuis users), compteurs de limitation, disque.
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE users, verifications RESTART IDENTITY CASCADE`)
  await supprimerCles(`${PREFIXE_LIMITES}*`)
  await rm(mediasDir(), { recursive: true, force: true })
  await mkdir(mediasDir(), { recursive: true })
})

afterAll(async () => {
  await db.$client.end()
  await redis.quit()
})
