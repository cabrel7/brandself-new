import { expect, test } from '@playwright/test'

// CA32 — toutes les routes /api/studio/** répondent 401 sans session.
// Aucune connexion ici : le contexte `request` n'a aucun cookie.

const ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

interface Route {
  methode: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

// S4 (S4-CA43) : réalisations, même patron que les services (élément `:id` uuid, action `reordonner`).
const ROUTES_S4: Route[] = [
  { methode: 'GET', chemin: '/api/studio/realisations' },
  { methode: 'POST', chemin: '/api/studio/realisations', corps: {} },
  { methode: 'GET', chemin: `/api/studio/realisations/${ID}` },
  { methode: 'PUT', chemin: `/api/studio/realisations/${ID}`, corps: {} },
  { methode: 'DELETE', chemin: `/api/studio/realisations/${ID}` },
  { methode: 'POST', chemin: '/api/studio/realisations/reordonner', corps: {} },
  // Identifiant mal formé : l'authentification passe quand même avant la validation (401, pas 400).
  { methode: 'GET', chemin: '/api/studio/realisations/pas-un-uuid' },
]

// S5 (témoignages) et S6 (liens) : collections, éléments et action statique `reordonner`.
// Les témoignages s'adressent par `:slug` (fichiers `[slug].*.ts`), les liens par `:id` (uuid).
// `reordonner` est une route statique : elle ne doit jamais être capturée par `:slug` / `:id`.
const ROUTES_S5_S6: Route[] = [
  { methode: 'GET', chemin: '/api/studio/temoignages' },
  { methode: 'POST', chemin: '/api/studio/temoignages', corps: {} },
  { methode: 'GET', chemin: '/api/studio/temoignages/avis-de-marie' },
  { methode: 'PUT', chemin: '/api/studio/temoignages/avis-de-marie', corps: {} },
  { methode: 'DELETE', chemin: '/api/studio/temoignages/avis-de-marie' },
  { methode: 'POST', chemin: '/api/studio/temoignages/reordonner', corps: {} },
  { methode: 'GET', chemin: '/api/studio/liens' },
  { methode: 'POST', chemin: '/api/studio/liens', corps: {} },
  { methode: 'GET', chemin: `/api/studio/liens/${ID}` },
  { methode: 'PUT', chemin: `/api/studio/liens/${ID}`, corps: {} },
  { methode: 'DELETE', chemin: `/api/studio/liens/${ID}` },
  { methode: 'POST', chemin: '/api/studio/liens/reordonner', corps: {} },
  // Identifiant mal formé : l'authentification passe quand même avant la validation (401, pas 400).
  { methode: 'GET', chemin: '/api/studio/liens/pas-un-uuid' },
]

// S7 (agenda, réservations, demandes) et S7-bis (refus, messages). Toutes les routes d'écriture
// reçoivent un corps vide ou invalide : l'authentification doit passer AVANT la validation.
const ROUTES_S7: Route[] = [
  { methode: 'GET', chemin: '/api/studio/agenda/disponibilites' },
  { methode: 'PUT', chemin: '/api/studio/agenda/disponibilites', corps: {} },
  { methode: 'GET', chemin: '/api/studio/agenda/indisponibilites' },
  { methode: 'POST', chemin: '/api/studio/agenda/indisponibilites', corps: {} },
  { methode: 'DELETE', chemin: `/api/studio/agenda/indisponibilites/${ID}` },
  { methode: 'GET', chemin: '/api/studio/reservations' },
  { methode: 'PATCH', chemin: `/api/studio/reservations/${ID}/confirmer`, corps: {} },
  { methode: 'PATCH', chemin: `/api/studio/reservations/${ID}/annuler`, corps: {} },
  { methode: 'PATCH', chemin: `/api/studio/reservations/${ID}/refuser`, corps: {} },
  { methode: 'GET', chemin: '/api/studio/demandes' },
  { methode: 'PATCH', chemin: `/api/studio/demandes/${ID}`, corps: {} },
  { methode: 'GET', chemin: '/api/studio/messages' },
  { methode: 'POST', chemin: `/api/studio/messages/${ID}/lu`, corps: {} },
  // Identifiants mal formés : l'authentification passe quand même avant la validation (401, pas 400).
  { methode: 'PATCH', chemin: '/api/studio/reservations/pas-un-uuid/refuser', corps: {} },
  { methode: 'POST', chemin: '/api/studio/messages/pas-un-uuid/lu', corps: {} },
]

const TOUTES_LES_ROUTES: Route[] = [
  ...ROUTES_S2,
  ...ROUTES_S3,
  ...ROUTES_S4,
  ...ROUTES_S5_S6,
  ...ROUTES_S7,
]

test.describe('CA32 /api/studio/** sans session', () => {
  for (const route of TOUTES_LES_ROUTES) {
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
