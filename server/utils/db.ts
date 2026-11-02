import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../../shared/env'
import * as schema from '../../shared/db/schema'

const POOL_MAX_CONNEXIONS = 10
/** Attente maximale d'une connexion libre : mieux vaut une erreur franche qu'une requête suspendue sans fin. */
const POOL_CONNECTION_TIMEOUT_MS = 10_000
/** Une transaction restée ouverte sans activité (appel externe, crash applicatif) libère sa connexion et ses verrous. */
const POOL_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000

function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: POOL_MAX_CONNEXIONS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    idle_in_transaction_session_timeout: POOL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  })
  return drizzle(pool, { schema })
}

type Db = ReturnType<typeof createDb>

const g = globalThis as typeof globalThis & { __dbBrandself?: Db }

export const db: Db = g.__dbBrandself ?? createDb()

if (env.NODE_ENV !== 'production') {
  g.__dbBrandself = db
}

export { schema }
