---
managed-by: claude-system-v5
name: nitro
description: Utiliser pour le backend d'une app Nuxt full-stack (dossier server/, moteur Nitro/H3) — architecture en couches type Laravel, gestion d'erreurs, auth par session, zod, Prisma ou Drizzle, tâches planifiées, déploiement VPS. Front Nuxt → skill vue3, design → ui-ux.
---

# Nuxt / Nitro (backend, dossier server/)

> Nitro n'est PAS opinionated (comme Express, ≠ Laravel) : il donne des primitives, pas une
> architecture. Ce skill IMPOSE une structure en couches, équivalent Nitro du cadre Laravel.
> Frontend Nuxt → `vue3/SKILL.md` · design → `ui-ux/SKILL.md`.

## Structure imposée (parallèle de app/ Laravel)
```
server/
  api/          # "controllers" fins : reçoit, valide, délègue au service, retourne
  services/     # logique métier — AUCUN accès à l'event H3 ici
  policies/     # autorisation : can(user, action, resource)
  schemas/      # zod : validation d'entrée + mappers/resources de sortie
  resources/    # mise en forme des réponses (jamais l'objet Prisma/Drizzle brut)
  middleware/   # contexte auth, logging (GLOBAL — gate à l'intérieur)
  plugins/      # error-handler central, extensions Prisma (observers), init
  utils/        # db (singleton ORM), storage (unstorage), helpers
  exceptions/   # exceptions métier typées (NotFoundError, ForbiddenError…)
  tasks/        # scheduled tasks (voir garde-fou cluster)
```

## Correspondance Laravel → Nitro
| Laravel | Nitro |
|---|---|
| Controller | `server/api/*.ts` (`defineEventHandler`, mince) |
| Service | `server/services/*.ts` |
| Form Request (validation) | zod via `readValidatedBody` / `getValidatedQuery` |
| Form Request (authz) | `requireUserSession` + policy |
| Policy | `server/policies/*.ts` |
| API Resource | `server/resources/*.ts` (mapper `toXResource`) |
| Observer | Prisma Client Extensions / `$extends` (dans un plugin) |
| Exception Handler | `createError` + hook `error` (plugin central) |
| Middleware | `server/middleware/*.ts` |

## Handler type (mince, délègue)
```ts
// server/api/items/index.post.ts
import { createItemSchema } from '~~/server/schemas/item'
export default defineEventHandler(async (event) => {
  const user = await requireUserSession(event)                 // auth
  await useItemPolicy().authorizeCreate(user)                  // autorisation
  const data = await readValidatedBody(event, createItemSchema.parse)  // validation zod
  const item = await useItemService().create(user, data)       // logique métier
  return toItemResource(item)                                  // sortie mise en forme
})
```

## Gestion des erreurs (le point clé — rien d'automatique)
1. **Erreurs HTTP contrôlées** : `throw createError({ statusCode: 422, statusMessage: '...', data })`.
2. **Exceptions métier typées** (les services les lèvent sans connaître le HTTP) :
```ts
// server/exceptions/http.ts
export class DomainError extends Error { constructor(msg: string, public status = 400, public data?: unknown){ super(msg) } }
export class NotFoundError extends DomainError { constructor(m='Introuvable'){ super(m,404) } }
export class ForbiddenError extends DomainError { constructor(m='Interdit'){ super(m,403) } }
```
3. **Handler central** (mappe + logue sans PII, prod masque la stack) :
```ts
// server/plugins/error-handler.ts
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error, { event }) => {
    const status = (error as any).status ?? (error as any).statusCode ?? 500
    consola.error({ url: event?.path, status, msg: error.message })   // jamais de PII/secret
    // brancher Sentry ici si dispo
  })
})
```
En prod, `NUXT_...` masque la stack automatiquement ; ne JAMAIS renvoyer `error.message` brut d'une 500.

## Auth (nuxt-auth-utils) + RBAC 3 rôles
- Cookie de session scellé (`NUXT_SESSION_PASSWORD` ≥ 32 chars, en env). `SameSite=Strict` → CSRF couvert.
- `setUserSession(event, { user: { id, role } })` au login · `requireUserSession(event)` sur les routes protégées.
- RBAC via policies : `super_admin` / `admin_filiale` / `employe`. La vérif de rôle vit dans `server/policies/`,
  jamais dans le handler.

## ORM — Prisma OU Drizzle (choix par projet, noté dans PROJECT_CONTEXT)
- **Prisma** (défaut VPS/Node) : DX + migrations. Singleton OBLIGATOIRE (sinon pool épuisé en HMR) :
```ts
// server/utils/db.ts
import { PrismaClient } from '@prisma/client'
const g = globalThis as unknown as { prisma?: PrismaClient }
export const db = g.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') g.prisma = db
```
- **Drizzle** : plus léger, edge/serverless. Client SQL-first, migrations `drizzle-kit`.
- Toujours des requêtes paramétrées (jamais de SQL brut concaténé).

## Config (runtimeConfig, jamais process.env éparpillé)
```ts
// nuxt.config.ts
runtimeConfig: { sessionPassword: '', dbUrl: '',       // SERVEUR (secrets)
  public: { apiBase: '/api' } }                        // CLIENT (jamais de secret ici !)
```
Dans le code serveur : `const cfg = useRuntimeConfig(event)`. Un secret dans `public` part au navigateur.

## routeRules (rendu hybride + headers)
```ts
routeRules: {
  '/':          { isr: 3600 },              // public : ISR
  '/dashboard/**': { ssr: false },          // admin : SPA
  '/api/**':    { cors: false, headers: { 'X-Content-Type-Options': 'nosniff' } },
}
```
Headers sécurité complets via le module `nuxt-security` (HSTS, CSP, frame-guard).

## Rate limiting (sans Redis à petite échelle)
Compteur via `unstorage` (`useStorage()`), clé = IP+route, fenêtre glissante. ⚠️ En cluster PM2,
le driver mémoire/fs n'est PAS partagé entre workers (limite par worker) — driver partagé si besoin d'un vrai global.

## Scheduled tasks + GARDE-FOU cluster (piège majeur)
Nitro Scheduled Tasks (`server/tasks/`) OU cron système. ⚠️ En `pm2 -i max`, une tâche se déclenche
sur CHAQUE worker → exécution multipliée. Solutions : cron système externe frappant UN endpoint protégé,
OU un process PM2 dédié `-i 1` pour les tâches, OU un verrou (lock en DB/unstorage).

## Tests
`@nuxt/test-utils` + Vitest : `await setup({ server: true })` puis `$fetch('/api/...')`. Couvre
200/201/401/403/404/422. Colle la SORTIE BRUTE d'exécution.

## Checklist sécurité/robustesse (à COCHER dès l'init — données sensibles = non négociable)
- [ ] `NUXT_SESSION_PASSWORD` ≥ 32 chars en env · cookies `SameSite=Strict` · CORS restreint à ton domaine
- [ ] zod sur CHAQUE route (jamais confiance au client) · policies sur toute mutation
- [ ] rate limit sur login + formulaires publics · logs consola SANS PII
- [ ] Backups Postgres automatisés (`pg_dump` cron + copie hors-site) · user DB à privilèges restreints
- [ ] Déploiement : `prisma migrate deploy` (jamais `dev`) AVANT `pm2 reload` · endpoint `/api/health`
- [ ] PM2 cluster (`pm2 start .output/server/index.mjs -i max`) · reverse proxy TLS (Caddy auto ou Nginx+certbot)

## Anti-patterns interdits
Logique métier dans un handler · objet ORM brut renvoyé · `new PrismaClient()` hors du singleton ·
`process.env` dans server/ (→ `useRuntimeConfig`) · secret dans `runtimeConfig.public` ·
route sans zod · scheduled task non protégée en cluster · `error.message` brut renvoyé sur une 500.
