import { defineConfig } from 'drizzle-kit'
import { env } from './shared/env'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
