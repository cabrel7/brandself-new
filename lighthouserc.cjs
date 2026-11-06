// S12 (#162) : configuration Lighthouse CI. Lancée sur le build de production.
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      startServerCommand: 'node .output/server/index.mjs',
      startServerReadyPattern: 'ready',
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/dr-cabrel',
        'http://localhost:3000/dr-cabrel/services/consultation-de-cardiologie',
        'http://localhost:3000/@dr-cabrel',
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
    upload: {
      target: 'temporary-public-storage',
    },
  },
}
