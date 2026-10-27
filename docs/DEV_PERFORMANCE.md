# Serveur de développement : lancement et performances

Machine de référence : 4 cœurs, 7 Go de RAM, partagée avec l'éditeur, le navigateur et d'autres sessions.

## Lancer

- **Un seul `pnpm dev:app` à la fois dans ce dossier.** Un second serveur écrase `.nuxt` et le cache Vite : le navigateur affiche alors une erreur.
- Attendre le message « Ready » (environ 2 à 3 minutes à froid), puis ouvrir `/connexion` et **patienter sans recharger** jusqu'au premier chargement complet (environ 2 à 3 minutes de plus à froid). Les pages suivantes répondent en moins d'une seconde.
- Tant que le JavaScript n'est pas chargé, la page s'affiche mais les boutons ne font rien : un formulaire se soumet nativement (l'adresse apparaît dans l'URL). Ce n'est pas un bogue de la page, il faut attendre la fin du premier chargement.
- Éviter de lancer en parallèle un typecheck, Playwright ou un autre serveur de développement : le CPU est le goulot, pas la mémoire.
- Ne pas vider `node_modules/.cache/nuxt/fonts` sans raison : le cache évite de retélécharger les polices.

## Causes établies (mesures du 2026-10-27)

| Cause | Preuve | Correctif |
|---|---|---|
| `nuxt-og-image` fait échouer le build Nitro de dev (téléchargement de polices) : « dev server unavailable », 503 prolongé | journal : `Could not load virtual:#og-image-virtual/build-dir.mjs after 4 attempts` ; disparaît quand `ogImage` est coupé | `$development` dans `nuxt.config.ts` |
| Transformation de tout le graphe SSR au premier rendu (Vite, @nuxt/ui, Tailwind, polices), mono-thread | profil CPU : environ 115 s sans repos sur 144 s | non supprimable ; réduit par la désactivation des sous-modules SEO et des sourcemaps en dev |
| Machine saturée (load 5 à 10 sur 4 cœurs) | `uptime`, `top` | fermer les autres charges |
| Dépendances redécouvertes à chaud (rechargement de page, hydratation cassée) | comportement Vite connu | `optimizeDeps.include` (dayjs, sortablejs, useSortable) |

Écarté : manque de mémoire (pic 0,9 à 1,4 Go, aucun OOM, pression mémoire nulle) et processus séparé (un seul process node).

## Mesures

- Démarrage à froid jusqu'à « Ready » : 2 min 21 à 3 min 18 (charge machine 5 à 8).
- Première page à froid : 138 à 160 s après « Ready ».
- Pages à chaud : 0,66 à 0,93 s.
- Rebuild après modification d'un fichier serveur : 12 à 24 s (le worker redémarre, un 503 de quelques secondes est normal).
- Aucune mesure « avant » propre : la charge externe variait trop. Les réglages `sourcemap` et `nitro.externals.trace` en dev ne sont pas démontrés utiles.

## Pistes non testées

- Polices : fournisseur local ou familles vides en dev pour supprimer la dépendance réseau.
- Tailwind `@source` plus étroit.
- Dev minimal (modules désactivés en bloc) pour borner le coût de chaque module (phase « modules » : 28 à 48 s).
- Réchauffement automatique de `/connexion` après « Ready ».
- `IPC connection closed` : non reproduit ; hypothèse : redémarrage du worker Nitro pendant une requête, ou second `nuxt dev` dans le même dossier.

## Alternative fiable pour les tests

`nuxt dev` est trop lent pour les e2e sur cette machine : utiliser `pnpm build` puis `.output/server/index.mjs` (voir `docs/JOURNAL_DECISIONS.md`).
