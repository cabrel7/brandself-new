# Bibliothèques adoptées

Tableau tenu à jour à chaque ajout de dépendance (règle 4.12 de `CLAUDE.md` : « bibliothèque d'abord »). Chaque ligne donne la raison de l'ajout.

| Bibliothèque | Raison |
|---|---|
| Better Auth | compte, Google, OTP email et téléphone |
| Drizzle (+ drizzle-kit) | base typée, migrations `db:generate`/`db:migrate` (drizzle-zod : à installer avec les premiers schémas, S1) |
| `pg` (node-postgres) | driver PostgreSQL de Drizzle (process Node longs) |
| BullMQ + ioredis | jobs et planification (rappels, emails, IA) |
| `@nuxt/ui` | base de composants accessibles (boutons, champs, interrupteurs…) thémée sur les variables CSS des palettes ; embarque `@nuxt/icon` (icônes Phosphor `ph`). Les `Bs*` ne sont que des surcouches métier |
| `@nuxtjs/seo`, `@nuxt/image`, `@nuxt/fonts` | SEO, images, polices |
| `@iconify-json/ph` | collection Phosphor installée en local : icônes `i-ph-*` sans appel à l'API publique d'Iconify |
| `concurrently` | `pnpm dev` lance app et worker ensemble |
| Tailwind CSS 4 (`@tailwindcss/vite`) | styles branchés sur les variables CSS des palettes |
| `sharp` | traitement d'images |
| Resend | emails |
| VueUse, dayjs | utilitaires, dates et fuseaux |
| `qrcode` | QR codes |
| `@nuxt/eslint` (eslint + typescript-eslint) | lint ; **TypeScript 6 obligatoire** : typescript-eslint ne supporte pas TS 7 |
| tsx | exécuter `worker/`, `db:seed` et scripts en TypeScript (process séparé de Nitro) |
| `@sindresorhus/slugify` | slugs des services : translittération des accents et de « œ », `&` → « et » (S3) |
| `@vueuse/integrations` + `sortablejs` (+ `@types/sortablejs`) | réordonnancement des services par glisser-déposer (`useSortable`), avec repli clavier (S3) |
| Vitest, Playwright (1.62) | tests ; version épinglée sur la révision Chromium déjà en cache |
| `unstorage` (driver `fs`) | stockage des médias derrière une interface unique (disque aujourd'hui, S3/R2 plus tard) ; `createStorage` direct pour rester testable hors Nitro |
| `h3` (1.15.11, épinglé sur la version de Nitro) | dépendance directe : `server/utils/api.ts`, `validation.ts` et les routes l'importent explicitement (pnpm strict) ; doit suivre la version embarquée par Nuxt |
| `@js-temporal/polyfill` | calcul des créneaux dans le fuseau de la vitrine, y compris les transitions DST et les heures locales ambiguës ou inexistantes (S7) |
| `@anthropic-ai/sdk` | adaptateur Anthropic de l'interface `IaProvider` (S8) : SDK officiel, TypeScript, maintenu ; sortie forcée par outil. Il apporte `@opentelemetry/api` (peer optionnel résolu par pnpm, aucune version existante modifiée). Clé et modèle par `runtimeConfig`/`IA_*`, jamais en dur |
| `isbot` | détection des robots/crawlers pour ne pas compter leurs visites dans les statistiques (S11) et pour le SEO (S12) |
| `ua-parser-js` | catégorisation de l'appareil (mobile/tablette/ordinateur) côté serveur, lors de la collecte d'une vue (S11) |
| `@axe-core/playwright` | Tests d'accessibilité (axe) sur le build de production pour S12 (WCAG 2A/2AA, 0 violation critical/serious) |
| `@lhci/cli` | Lighthouse CI pour le sprint S12 : budgets LCP ≤ 2500 ms, CLS ≤ 0,1, TBT ≤ 300 ms, scores SEO ≥ 0,95, accessibilité ≥ 0,95, sur le build de production |
| `openai` (SDK officiel) | second adaptateur de `IaProvider` (S8) : parle l'API « compatible OpenAI » que Gemini, Groq, Mistral, DeepSeek, OpenRouter et Ollama exposent aussi ; adresse par `IA_BASE_URL` (HTTPS), modèle obligatoire par `IA_MODELE` |
| `@better-auth/mcp` | plugin Better Auth MCP, authentification OAuth 2.1 pour le serveur MCP (S16) |
| `@modelcontextprotocol/sdk` | SDK officiel du protocole MCP, serveur McpServer et types (S16) |
