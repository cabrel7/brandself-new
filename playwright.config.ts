import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // SEO et accessibilité s'exécutent sur le build de production (playwright.seo.config.ts, job `seo-perf`).
  // Les specs `capture-*` sont des outils de capture d'écran (maquettes, revues), pas des garanties : exclues de la CI,
  // lançables en local (`pnpm exec playwright test e2e/capture-admin-a4.spec.ts`).
  testIgnore: ['seo/**', 'a11y/**', ...(process.env.CI ? ['**/capture-*.spec.ts'] : [])],
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
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // A1 : l'administration vit sur son propre hôte. `admin.localhost` n'est pas résolu par le système : Chromium
        // le renvoie vers la boucle locale (le serveur de développement écoute sur 127.0.0.1). Sans effet sur les
        // autres hôtes ni sur les requêtes brutes (`request`, qui ne passent pas par le navigateur).
        launchOptions: { args: ['--host-resolver-rules=MAP admin.localhost 127.0.0.1'] },
      },
    },
  ],
})
