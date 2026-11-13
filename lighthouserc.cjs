// S12 (#162) : configuration Lighthouse CI, sur le build de production.
// Les budgets reprennent BUDGET_* de shared/seo.ts (un test unitaire vérifie qu'ils sont identiques).
// En CI, le serveur est déjà démarré par le workflow (partagé avec e2e:seo) : on ne le relance pas.
// En local (`pnpm perf:local`), lhci démarre lui-même le serveur et attend sa ligne « Listening ».
const PORT = process.env.PORT_SERVEUR || '3000'
const BASE = `http://localhost:${PORT}`
const DEMARRAGE_LOCAL = process.env.CI
  ? {}
  : { startServerCommand: 'node .output/server/index.mjs', startServerReadyPattern: 'Listening', startServerReadyTimeout: 120000 }

module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      ...DEMARRAGE_LOCAL,
      // `/@dr-cabrel` (lien en bio) est volontairement `noindex` : son score SEO ne serait jamais valide.
      url: [
        `${BASE}/`,
        `${BASE}/tarifs`,
        `${BASE}/dr-cabrel`,
        `${BASE}/dr-cabrel/services/consultation-de-cardiologie`,
      ],
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
      },
    },
    // Aucun envoi vers un stockage public : rapports écrits sur disque, publiés en artefact par le workflow.
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
}
