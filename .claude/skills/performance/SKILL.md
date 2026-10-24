---
managed-by: claude-system-v5
name: performance
description: Utiliser pour optimiser la performance web — Core Web Vitals (LCP/CLS/INP), taille de bundle, lazy loading, optimisation d'images, cache, requêtes N+1. Lire avant d'optimiser ou d'auditer la perf.
---

# Performance web

## Core Web Vitals (cibles)
- **LCP** (Largest Contentful Paint) < 2.5s — image/héros optimisé, preload, SSR.
- **CLS** (Cumulative Layout Shift) < 0.1 — dimensions réservées (width/height, aspect-ratio),
  pas d'injection qui pousse le contenu.
- **INP** (Interaction to Next Paint) < 200ms — pas de JS bloquant, débounce, web workers.

## Frontend
- **Bundle** : analyse (`vite build --report` / `rollup-plugin-visualizer`), code-splitting par route
  (lazy `() => import()`), tree-shaking, pas d'import de librairie entière pour une fonction.
- **Images** : formats modernes (WebP/AVIF), `loading="lazy"`, `srcset` responsive, dimensions fixées.
- **Fonts** : `font-display: swap`, preload de la police critique, sous-ensemble (subset).
- **Rendu** : virtualisation des longues listes, mémoïsation ciblée (jamais partout), pas de
  recalcul dans le rendu.

## Backend / DB
- **N+1** : eager loading (`with()` en Laravel), jamais de requête dans une boucle.
- **Index** sur toute colonne filtrée/triée/jointe fréquemment.
- **Cache** : Redis pour les données coûteuses et stables (TTL adapté), invalidation à l'écriture.
- **Jobs** : toute opération > 500ms hors du cycle requête (queue).
- **Pagination** : jamais de `all()` sur une grande table.

## Cache HTTP
- Assets fingerprintés : `Cache-Control: public, max-age=31536000, immutable`.
- HTML/API : `no-cache` ou TTL court + ETag.

## Méthode d'optimisation
1. MESURE d'abord (Lighthouse, `console.time`, EXPLAIN sur la requête) — pas de supposition.
2. Trouve le vrai goulot (souvent 1 requête, 1 image, 1 import).
3. Corrige, RE-MESURE, prouve le gain chiffré.
N'optimise jamais sans mesure avant/après.
