---
managed-by: claude-system-v5
name: drizzle
description: Utiliser pour Drizzle ORM (TypeScript, Postgres/MySQL/SQLite) — schéma typé, migrations (drizzle-kit ou dbmate + squawk), requêtes sûres, multi-tenant, singleton client. Pour les règles de migration lourdes → voir aussi l'agent database.
---

# Drizzle ORM

## Schéma & client
- Schéma typé dans `schema.ts` (tables, relations, types inférés).
- **Client singleton** (sinon pool épuisé en dev/HMR) — typé, sans `any` ni `process.env` brut
  (tous deux bloqués par les guard-rules) :
```ts
import { env } from '@/env'            // module env typé (valide process.env une seule fois)
type Db = ReturnType<typeof drizzle>
const g = globalThis as typeof globalThis & { __db?: Db }
export const db: Db = g.__db ?? drizzle(pool, { schema })
if (env.NODE_ENV !== 'production') g.__db = db
```

## Migrations — UNE approche, choisie dans PROJECT_CONTEXT (jamais les deux)
- **Option A — dbmate + squawk** (SQL versionné = source de vérité) : `.sql` avec `-- migrate:up` /
  `-- migrate:down`, `squawk` pour linter (locks, NOT NULL sur grosse table…), puis `drizzle-kit pull`
  (et SEULEMENT `pull`) pour régénérer le schéma TS. Si dbmate est choisi, `drizzle-kit generate`,
  `migrate` et `push` sont INTERDITS (deux sources de vérité = divergence garantie).
- **Option B — drizzle-kit** : `generate` (depuis le schéma) → `migrate` (applique). `push` = dev only,
  JAMAIS en prod. Pas de dbmate en parallèle.
- Dans les deux cas : `down` testé (up→down→up), pas de verrou long en prod.

## Requêtes
- Query builder typé, jamais de `sql.raw` avec interpolation d'input (→ injection). Paramétrage via `sql``...${value}``.
- Multi-tenant : filtre d'organisation systématique (ou RLS au niveau DB).
- Transactions explicites pour les écritures multi-tables.

## Anti-patterns interdits
`new Drizzle/Pool` hors singleton · `sql.raw` avec input utilisateur · `drizzle-kit push` en prod ·
migration sans `down` · requête non scopée au tenant.
