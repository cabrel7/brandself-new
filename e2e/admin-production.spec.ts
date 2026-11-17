import { expect, test } from '@playwright/test'
import { appeler } from './helpers/admin'

// A1 (M2) : les fichiers de `public/` (sw.js, manifest.json, favicon.ico) sont servis par Nitro AVANT les
// middlewares. Le plugin `server/plugins/hote-admin.ts` les couvre en BUILD DE PRODUCTION (la méthode d'une requête
// refusée devient OPTIONS, le handler statique ne sert alors rien, `00-hote.ts` lève le 404).
// LIMITE CONNUE : sous `pnpm dev`, le serveur de fichiers statiques de Nitro répond 200 avant le hook : ces cas ne
// sont donc PAS fiables, et ne sont pas exécutés, hors build de production. Ils ne tournent que si
// `E2E_BUILD_PRODUCTION=1` (serveur de production déjà démarré sur E2E_BASE_URL). Sans la variable, le fichier ne
// déclare aucun test (aucun test « sauté » : il n'existe pas). La condition est la même que celle de la CI SEO/Lighthouse.
// `/favicon.ico` n'y figure PAS : `decisionHote` le laisse passer sur l'hôte d'administration (liste blanche, onglet du
// navigateur), il y répond donc 200 (écart avec la consigne « 404 », à trancher).
// Les tests de décision sont couverts sans serveur par tests/unit/admin/hote-serveur.test.ts.

if (process.env.E2E_BUILD_PRODUCTION === '1') {
  test.describe('hôte d\'administration en build de production : fichiers statiques fermés', () => {
    for (const chemin of ['/sw.js', '/manifest.json', '/offline.html', '/brand/../sw.js']) {
      test(`GET ${chemin} sur l'hôte d'administration : 404, jamais le fichier`, async () => {
        const reponse = await appeler({ chemin })

        expect(reponse.status).toBe(404)
        expect(reponse.corps).not.toMatch(/serviceWorker|self\.addEventListener|"start_url"/)
        expect(String(reponse.headers['x-robots-tag'])).toMatch(/noindex/)
      })
    }

    test('les mêmes fichiers restent servis sur le site public (témoin)', async () => {
      for (const chemin of ['/sw.js', '/manifest.json']) {
        const reponse = await appeler({ chemin, hote: 'public' })
        expect(reponse.status, chemin).toBe(200)
      }
    })
  })
}
