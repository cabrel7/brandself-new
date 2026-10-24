import { sql } from 'drizzle-orm'
import { db } from '../utils/db'

// S0 — seed vide : la vitrine de démonstration dr-cabrel arrive en S2 (PROJECT_CONTEXT.md §15).
async function main(): Promise<void> {
  await db.execute(sql`SELECT 1`)
  console.info('Seed S0 : rien à insérer. La démonstration dr-cabrel arrive en S2.')
}

main()
  .then(() => process.exit(0))
  .catch((erreur: unknown) => {
    console.error('Seed en échec :', erreur)
    process.exit(1)
  })
