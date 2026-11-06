// S11 : seed statistiques déterministes (CA25).
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { count, eq, sum } from 'drizzle-orm'
import { db } from '../../server/utils/db'
import { statistiquesJour, vitrines } from '../../shared/db/schema'

/** Vitrine de démonstration `dr-cabrel` (ID fixé dans server/db/seed.ts). */
const ID_VITRINE = 'seed-vitrine-dr-cabrel'
const SEED_DB_URL = 'postgresql://cabrel:brandself_dev@127.0.0.1:5433/brandself_test'

function execSeed(): void {
  execFileSync('pnpm', ['db:seed'], {
    env: { ...process.env, DATABASE_URL: SEED_DB_URL },
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 180_000,
  })
}

/** Nombre de lignes agrégées et total des visites pour dr-cabrel. */
async function statistiquesDrCabrel(): Promise<{ nbLignes: number, totalVisites: number }> {
  const [{ nbLignes, totalVisites }] = await db
    .select({
      nbLignes: count(),
      totalVisites: sum(statistiquesJour.visites),
    })
    .from(statistiquesJour)
    .where(eq(statistiquesJour.vitrineId, ID_VITRINE))
  return { nbLignes: Number(nbLignes), totalVisites: Number(totalVisites ?? 0) }
}

describe('seed statistiques (S11 CA25)', () => {
  it('est déterministe et dr-cabrel a des visites > 0 sur 7 j', async () => {
    execSeed()
    const premier = await statistiquesDrCabrel()
    expect(premier.nbLignes).toBeGreaterThan(0)
    expect(premier.totalVisites).toBeGreaterThan(0)
    // Idempotent : un second run régénère les mêmes données.
    execSeed()
    const second = await statistiquesDrCabrel()
    expect(second).toEqual(premier)
  }, 180_000)

  it('la vitrine dr-cabrel existe et est publiée', async () => {
    execSeed()
    const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.id, ID_VITRINE))
    expect(vitrine).toBeDefined()
    expect(vitrine.publieeLe).not.toBeNull()
  })
})
