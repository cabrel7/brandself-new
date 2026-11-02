import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Démarrage à froid mesuré à 2m47s sur cette machine (hydration/prepare) :
    // 120 s faisait échouer le premier lancement sans serveur préchauffé.
    timeout: 300_000,
  },
  // Machine de 7 Go partagée : deux workers Chromium déclenchent des
  // ERR_ABORTED (renderer OOM) — la sérialisation évite les navigations avortées.
  workers: 1,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
