import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { TestProject } from 'vitest/node'
import { assertBaseDeTest, assertRedisDeTest } from './support/garde-base'

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    assertBaseDeTest(process.env.DATABASE_URL)
    assertRedisDeTest(process.env.REDIS_URL)
  } catch (erreur) {
    // Vitest 5 plante en affichant une erreur levée par un globalSetup (« code.charCodeAt is not a
    // function ») : on écrit donc le motif du refus nous-mêmes avant de relancer l'erreur.
    console.error(`\n[tests d'intégration] ${erreur instanceof Error ? erreur.message : String(erreur)}\n`)
    throw erreur
  }

  const mediasDir = project.config.env?.MEDIAS_DIR
  if (!mediasDir) {
    throw new Error('MEDIAS_DIR doit être défini dans la configuration du projet "integration".')
  }

  // Migrations réelles (celles livrées avec l'application, 0009 comprise).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: DOSSIER_MIGRATIONS })
  } finally {
    await pool.end()
  }

  await rm(mediasDir, { recursive: true, force: true })
  await mkdir(mediasDir, { recursive: true })

  return async () => {
    await rm(mediasDir, { recursive: true, force: true })
  }
}
