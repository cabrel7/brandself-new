import { expect, test } from '@playwright/test'

// CA32 — toutes les routes /api/studio/** répondent 401 sans session.
// Aucune connexion ici : le contexte `request` n'a aucun cookie.

const ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

interface Route {
  methode: 'GET' | 'POST' | 'PUT' | 'DELETE'
  chemin: string
  /** Corps volontairement invalide : l'authentification doit passer AVANT la validation (401, pas 400). */
  corps?: Record<string, unknown>
}

const ROUTES_S2: Route[] = [
  { methode: 'GET', chemin: '/api/studio/vitrine' },
  { methode: 'POST', chemin: '/api/studio/vitrine', corps: {} },
  { methode: 'PUT', chemin: '/api/studio/vitrine', corps: {} },
  { methode: 'PUT', chemin: '/api/studio/vitrine/username', corps: {} },
  { methode: 'POST', chemin: '/api/studio/vitrine/publier' },
  { methode: 'POST', chemin: '/api/studio/vitrine/depublier' },
  { methode: 'GET', chemin: '/api/studio/username-disponible?username=abc' },
  { methode: 'GET', chemin: '/api/studio/moi' },
  { methode: 'PUT', chemin: '/api/studio/moi', corps: {} },
  { methode: 'DELETE', chemin: '/api/studio/moi', corps: { confirmation: 'SUPPRIMER' } },
  { methode: 'POST', chemin: '/api/studio/medias' },
  { methode: 'DELETE', chemin: `/api/studio/medias/${ID}` },
  { methode: 'GET', chemin: '/api/studio/appareils' },
  { methode: 'DELETE', chemin: `/api/studio/appareils/${ID}` },
]

// S3 (S3-CA38) : services. Toutes les routes, y compris celles d'un élément (`:id` uuid) et l'action
// `reordonner` (route statique : ne doit jamais être capturée par `:id`).
const ROUTES_S3: Route[] = [
  { methode: 'GET', chemin: '/api/studio/services' },
  { methode: 'POST', chemin: '/api/studio/services', corps: {} },
  { methode: 'GET', chemin: `/api/studio/services/${ID}` },
  { methode: 'PUT', chemin: `/api/studio/services/${ID}`, corps: {} },
  { methode: 'DELETE', chemin: `/api/studio/services/${ID}` },
  { methode: 'POST', chemin: '/api/studio/services/reordonner', corps: {} },
  // Identifiant mal formé : l'authentification passe quand même avant la validation (401, pas 400).
  { methode: 'GET', chemin: '/api/studio/services/pas-un-uuid' },
]

// Collections des sprints suivants (leurs routes `[slug]` seront ajoutées au fil de S4 à S6,
// quand leurs fichiers `x.[slug].ts` seront renommés et deviendront atteignables).
const ROUTES_COLLECTIONS: Route[] = ['realisations', 'temoignages', 'liens'].flatMap((ressource) => [
  { methode: 'GET' as const, chemin: `/api/studio/${ressource}` },
  { methode: 'POST' as const, chemin: `/api/studio/${ressource}`, corps: {} },
])

test.describe('CA32 /api/studio/** sans session', () => {
  for (const route of [...ROUTES_S2, ...ROUTES_S3, ...ROUTES_COLLECTIONS]) {
    test(`CA32 ${route.methode} ${route.chemin} répond 401`, async ({ request }) => {
      const reponse = await request.fetch(route.chemin, { method: route.methode, data: route.corps })

      expect(reponse.status()).toBe(401)
    })
  }

  test('CA32 un cookie de session forgé est refusé (401)', async ({ playwright }) => {
    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
      extraHTTPHeaders: { Cookie: 'better-auth.session_token=jeton-invente.signature-invente' },
    })

    const reponse = await api.get('/api/studio/moi')

    expect(reponse.status()).toBe(401)
    await api.dispose()
  })
})
