import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../../shared/env'
import * as schema from '../../shared/db/schema'

function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
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
