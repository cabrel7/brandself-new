// S12 (#162) : projet Playwright dédié aux tests SEO (e2e/seo) et d'accessibilité (e2e/a11y) sur le BUILD de production.
// En CI, le serveur est démarré une seule fois par le workflow (partagé avec Lighthouse) : aucun `webServer` ici.
// En local : `pnpm build`, puis `NUXT_PUBLIC_SITE_URL=https://… pnpm e2e:seo` ; un serveur déjà lancé sur le port est réutilisé.
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT_SERVEUR ?? 3000)
const BASE_URL = `http://localhost:${PORT}`
const TIMEOUT_DEMARRAGE_MS = 120_000

export default defineConfig({
  testDir: './e2e',
  testMatch: ['seo/**/*.spec.ts', 'a11y/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: process.env.CI
    ? undefined
    : {
        command: 'node .output/server/index.mjs',
        url: BASE_URL,
        timeout: TIMEOUT_DEMARRAGE_MS,
        reuseExistingServer: true,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
