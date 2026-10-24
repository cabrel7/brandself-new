import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../../shared/env'
import * as schema from '../db/schema'

function creerDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  })
  return drizzle(pool, { schema })
}

type Db = ReturnType<typeof creerDb>

const g = globalThis as typeof globalThis & { __dbBrandself?: Db }

export const db: Db = g.__dbBrandself ?? creerDb()

if (env.NODE_ENV !== 'production') {
  g.__dbBrandself = db
}

export { schema }
