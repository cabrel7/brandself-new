import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const racine = path.dirname(fileURLToPath(import.meta.url))

// Un développeur peut déposer ses URL de test dans `.env.test` (modèle : `.env.test.example`,
// ignoré par git). `loadEnvFile` n'écrase pas les variables déjà définies : en CI, ce sont
// les variables du job qui gagnent.
const fichierEnvTest = path.join(racine, '.env.test')
if (existsSync(fichierEnvTest)) {
  process.loadEnvFile(fichierEnvTest)
}

// `h3` n'est pas une dépendance directe (pnpm strict) : Nitro le fournit au build, pas Vitest.
// On le résout depuis `nuxt`, qui en dépend, pour que `server/utils/api.ts` soit testable hors Nitro.
function resoudreH3(): string | undefined {
  try {
    const depuisRacine = createRequire(path.join(racine, 'package.json'))
    return createRequire(depuisRacine.resolve('nuxt/package.json')).resolve('h3')
  } catch {
    return undefined
  }
}
const h3 = resoudreH3()

/** Dossier de stockage des médias pour les tests d'intégration (vidé entre les tests). */
const MEDIAS_DIR_TEST = path.join(tmpdir(), 'brandself-tests-medias')

const SECRET_FACTICE = 'secret-de-test-au-moins-trente-deux-caracteres'

// Essai RÉEL optionnel contre le bac à sable K-PAY (S10 CA25) : le projet n'existe QUE si `KPAY_SANDBOX=1`. Sans cette variable il n'est
// pas enregistré, donc `pnpm test` (la gate, CI comprise) ne le voit, ne le compte et ne le saute jamais.
const projetsSandbox = process.env.KPAY_SANDBOX === '1'
  ? [{
      extends: true as const,
      test: {
        name: 'sandbox',
        include: ['tests/sandbox/**/*.test.ts'],
        testTimeout: 240_000,
        hookTimeout: 60_000,
      },
    }]
  : []

export default defineConfig({
  resolve: {
    alias: {
      '#server': path.join(racine, 'server'),
      '#shared': path.join(racine, 'shared'),
      ...(h3 ? { h3 } : {}),
    },
  },
  test: {
    projects: [
      {
        // Unitaires : aucune base, aucun service externe. L'environnement est factice.
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/*.test.ts'],
          // Premier import des services (drizzle, pg, sharp, ioredis) : 5 à 6 s à froid.
          testTimeout: 30_000,
          env: {
            DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
            REDIS_URL: 'redis://localhost:6379',
            NUXT_BETTER_AUTH_SECRET: SECRET_FACTICE,
          },
        },
      },
      {
        // Intégration : vrai PostgreSQL (base `*_test`), vrai Redis (/15), vrai disque (dossier
        // temporaire). DATABASE_URL et REDIS_URL ne sont PAS surchargées : elles viennent de
        // l'environnement (CI) ou de `.env.test`. Voir tests/integration/global-setup.ts.
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          env: {
            NUXT_BETTER_AUTH_SECRET: SECRET_FACTICE,
            MEDIAS_DIR: MEDIAS_DIR_TEST,
          },
        },
      },
      ...projetsSandbox,
    ],
  },
})
