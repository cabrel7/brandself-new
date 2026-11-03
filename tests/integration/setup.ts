import { mkdir, rm } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach } from 'vitest'
// PREMIER import applicatif : les variables K-PAY doivent exister avant que `shared/env.ts` ne lise `process.env`.
import { fauxKpay } from './support/env-kpay'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import { assertBaseDeTest, assertRedisDeTest } from './support/garde-base'

const PREFIXE_LIMITES = 'limite:'
/** Compteur global des appels K-PAY (S10 #110) : hors du préfixe des limiteurs, à remettre à zéro aussi. */
const PREFIXE_BUDGET_KPAY = 'kpay:'

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
  await db.execute(sql`TRUNCATE TABLE users, verifications, emails_transactionnels RESTART IDENTITY CASCADE`)
  await supprimerCles(`${PREFIXE_LIMITES}*`)
  await supprimerCles(`${PREFIXE_BUDGET_KPAY}*`)
  fauxKpay.reinitialiser()
  await rm(mediasDir(), { recursive: true, force: true })
  await mkdir(mediasDir(), { recursive: true })
})

afterAll(async () => {
  await fauxKpay.fermer()
  await db.$client.end()
  await redis.quit()
})
