---
managed-by: claude-system-v5
name: monorepo
description: Utiliser pour un monorepo JS/TS — pnpm workspaces (+ turborepo), paquets partagés, TypeScript strict partagé, Biome, commits conventionnels, changesets. Lire avant de créer un paquet/une app, ajouter une dépendance ou toucher la CI.
---

# Monorepo (pnpm + turborepo)

## Organisation
```
apps/        # applications déployables (web, api, worker…)
packages/    # code partagé (@scope/ui, @scope/config, @scope/db…)
pnpm-workspace.yaml · turbo.json · tsconfig.base.json · biome.json
```

## Règles
- **pnpm** (workspaces) + `--frozen-lockfile` en CI. Dépendance ajoutée au bon paquet (`pnpm --filter @scope/x add ...`), jamais à la racine sauf outillage.
- **turborepo** : tâches `build/test/lint/typecheck` avec cache et dépendances (`dependsOn`). Pas de script qui court-circuite le graphe.
- **TypeScript strict partagé** : un `tsconfig.base.json` étendu par chaque paquet. Pas de `any`.
- **Biome** (lint + format) à la place d'ESLint+Prettier. Un seul `biome.json` racine.
- Imports entre paquets par le nom du paquet (`@scope/ui`), jamais par chemin relatif `../../packages`.
- Frontières : une app ne dépend pas d'une autre app ; le partagé vit dans `packages/`.
- Commits conventionnels + changesets pour le versionnement des paquets publiés.

## Anti-patterns interdits
Dépendance mise à la racine par défaut · import relatif cross-paquet · `any` · tâche hors du graphe turbo · duplication de code au lieu d'un paquet partagé.
