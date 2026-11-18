# S13-A — Optimisation de la performance : spécification

Spécification rédigée par l'agent `architect` le 2026-11-17 (lecture du code, sans build). Les points marqués **(supposé)** restent à confirmer par la mesure. Contexte : `SPRINTS.md` S13 partie A ; mesure de départ Lighthouse CI du 2026-11-17 (build de production, mobile, 4G lente simulée, CPU x4, après compression gzip/brotli des fichiers publics).

## 0. Hypothèses explicites

- **H1.** La CI mesure Lighthouse contre `node .output/server/index.mjs`, sans nginx : HTTP/1.1, sans TLS ni h2, HTML non compressé (Nitro ne compresse que `public/`). Preset mobile par défaut. Une partie de l'écart avec la production vient donc du protocole, pas du code. **(supposé : `ci.yml` non relu par l'architecte)**
- **H2.** « FCP 7 s sur `/tarifs` » est incohérent avec un LCP de 4,4 s (LCP ≥ FCP) : attribuer chaque métrique à sa page depuis les `lhr-*.json` avant de commencer.
- **H3.** Budgets de `shared/seo.ts` inchangés (LCP 2 500 ms, performance 0,85, TBT 300 ms, `BUDGET_JS_KO` 200, `BUDGET_PAGE_KO` 900). Aucun seuil n'est abaissé en silence.

## 1. Diagnostic (lecture du code)

### 1.1 Chargé sur les pages publiques sans y servir

| # | Constat | Preuve | Effet |
|---|---|---|---|
| D1 | Client Better Auth dans l'entrée : plugin client et middleware globaux du module importent `useUserSession` → `useAuthClient` → `better-auth/client` + `emailOTPClient` + `phoneNumberClient` | `node_modules/@nuxtjs/better-auth/dist/module.mjs:377-386`, `runtime/app/plugins/session.client.js:2-4`, `app/auth.config.ts:1-5` | JS d'authentification exécuté sur `/`, `/tarifs`, vitrines (30 à 60 Ko bruts, supposé) |
| D2 | Requête de session côté client à chaque page (`useSession()` → probablement `GET /api/auth/get-session`) | `runtime/app/composables/useUserSession.js:139-140` | Requête par vue de vitrine (supposé, à confirmer par `network-requests`) |
| D3 | `/tarifs` et la landing importent la session pour `lienPayant` seulement, rendu seulement si `paiementDisponible` (faux en v1) | `app/composables/useTarifsAffichage.ts:38,56-59,83`, `nuxt.config.ts:65` | Garderaient le client d'authentification même après D1 |
| D4 | `dayjs-nuxt` inutilisé (aucun `useDayjs`/`$dayjs`) mais son plugin global charge dayjs + 3 extensions | `nuxt.config.ts:30,36-43` | ~8 à 12 Ko bruts dans l'entrée (supposé) |
| D5 | `InstallPrompt` monté partout, vitrines comprises : enregistre le service worker (`scope: '/'`) et précharge 5 fichiers alors que `cheminAutorise` limite l'affichage à `/`, `/tarifs`, `/studio/` | `app/app.vue:48`, `app/composables/usePwaInstall.ts:126,134,249-257`, `app/utils/pwa-install.ts:87-90`, `public/sw.js:11-17` | JS PWA dans l'entrée ; ~6 requêtes après chargement sur les vitrines. **Écart avec l'invariant CLAUDE.md §10** (PWA limitée au studio) |
| D6 | `UApp` enveloppe toutes les pages | `app/app.vue:2,32` | Coût de base de `@nuxt/ui` ; non retiré (voir §7) |
| D7 | CSS : sans `experimental.componentDetection`, `@nuxt/ui` écrit `@source "./ui"` (~120 thèmes) et scanne toute la couche `app/**` (studio et admin compris) | `node_modules/@nuxt/ui/dist/shared/ui.Ba0YYeuK.mjs:8898-8958`, `app/assets/css/main.css:1-2`, `nuxt.config.ts:33` | Explique l'essentiel des ~231 Ko bruts d'`entry.css` ; fichier unique et global |
| D8 | Polices : Fraunces 500, 600, 700 en normal et italique, `preload: true` | `nuxt.config.ts:130-136` | Jusqu'à 6 woff2 en priorité haute pendant la fenêtre FCP/LCP (supposé : compter les `<link rel=preload as=font>`) |
| D9 | ~62 `modulepreload` sur `/tarifs` en HTTP/1.1 (6 connexions par origine) | constat | Cause probable n°1 d'un LCP texte à 4-8 s : le `h1` est rendu au serveur (`marketing/Hero.vue:2,17-22`), la bande passante et le CPU sont saturés |
| D10 | HTML non compressé en CI ; l'accueil d'une vitrine charge au rendu serveur 31 jours de créneaux | `app/pages/[username]/index.vue:42-47`, `app/composables/usePublicAgenda.ts:4,152-168` | Document et payload gonflés (à mesurer) |

### 1.2 Pages de vitrine

- `vitrine/Nav.vue:63-105` : `USlideover` hydraté partout alors qu'il ne s'ouvre qu'au clic sous 768 px.
- `[username]/index.vue:56` : `AgendaPublic` (`USelect`) sous la ligne de flottaison hydraté immédiatement. Interactif : **`noScripts` exclu**.
- `[username]/services/[slug].vue:108-128` : `AgendaCreneauxProchains`, `ReservationDemandeForm`, `ServiceAutres` hydratés tout de suite.
- **LCP de 8,4 s sur le détail d'un service** : élément probable = image `ServiceVisuel` (`fetchpriority="high"`, variante 1600 : `server/resources/media.ts:9`). Hypothèses à départager : (a) variante générée à froid par sharp ; (b) `srcset` surdimensionné pour 412 px x DPR 1,75 ; (c) pas d'image : l'initiale en Fraunces est le LCP texte.
- Aucune bibliothèque serveur ne part côté client (`@js-temporal/polyfill`, `libphonenumber-js`, `ua-parser-js`, `isbot` : `server/` seulement ; `sortablejs` : studio ; `nuxt-qrcode` : `global: false`).

### 1.3 Cache et compression

- `deploy/nginx/brandself-location.conf:103-108` : `/_nuxt/` ajoute `Cache-Control` sans `proxy_hide_header` : en-tête probablement en double (supposé : `curl -I`).
- Le bloc `server` public n'est pas versionné ; seul `admin.conf:96-97` active `gzip` ; brotli jamais configuré : compression du HTML public en production **inconnue**.
- Pas de `location` pour `/_fonts/`, `/_ipx/`, `/landing/`.
- **`/landing/*.jpg` n'est pas empreinté** (noms fixes) : un cache `immutable` y serait une erreur.
- `compressPublicAssets` actif : ne pas ajouter de compression nginx dynamique sur `/_nuxt/` ; vérifier `Vary: Accept-Encoding`.

## 2. Leviers classés

| Rang | Levier | Fichiers | Mesure | Risque | Repli | Effort |
|---|---|---|---|---|---|---|
| L1 | Moins de préchargements concurrents (polices) | `nuxt.config.ts` (fonts) | LCP/FCP, requêtes haute priorité avant FCP | CLS | Graisses statiques | S |
| L2 | Client d'authentification hors des pages publiques | `modules/auth-differee.ts` (nouveau), `nuxt.config.ts`, `useTarifsAffichage.ts` | JS d'entrée, TBT, absence de `/api/auth/get-session` | **Élevé** (redirections studio, expiration) | Retirer le module local | M |
| L3 | Hydratation différée de la landing | `app/pages/index.vue`, `marketing/*` | TBT, JS exécuté, LCP de `/` | Effets d'apparition plus tardifs | Retirer `Lazy` | S |
| L4 | Vitrines : hydratation différée, menu chargé au clic | `vitrine/Nav.vue`, `[username]/index.vue`, `[username]/services/[slug].vue` | JS, TBT sur vitrines | Agenda, focus du menu, e2e réservation | Idem | M |
| L5 | CSS : détection des composants, palette réduite | `nuxt.config.ts` (`ui.experimental.componentDetection`, `ui.theme.colors`) | Taille de `entry.css`, FCP | Styles manquants (studio/admin) | Liste explicite ou `false` | S |
| L6 | InstallPrompt et service worker limités aux pages autorisées, différés | `app/app.vue`, `usePwaInstall.ts` | JS d'entrée, requêtes sur vitrines | Invariants S15 | Montage global | S |
| L7 | Retrait de `dayjs-nuxt` | `nuxt.config.ts`, `package.json`, lock, `docs/bibliotheques.md` | JS d'entrée | Quasi nul | Remettre | S |
| L8 | Image LCP du détail d'un service | selon diagnostic (`ci.yml` préchauffage, ou `sizes`) | LCP du détail | Mesure biaisée si préchauffage non déclaré | — | S-M |
| L9 | Document HTML : compression en CI, charge utile de l'agenda | `ci.yml`/`deploy/`, `[username]/index.vue` | `transferSize` du document | CPU serveur | Désactiver | M |
| L10 | Cache HTTP (`/_nuxt`, `/_fonts`, `/landing`, `/_ipx`) | `deploy/nginx/brandself-location.conf`, `nuxt.config.ts` (`routeRules`) | `curl -I` (gain nul sur Lighthouse, à froid) | Faible ; jamais `immutable` sur ce qui n'est pas empreinté | Retirer | S |
| L11 | `manualChunks` | `nuxt.config.ts` | `modulepreload`, octets | Cache moins fin | Supprimer | M, **seulement après analyse** |

### Détail

**L1** — Fraunces variable, un fichier par style : `{ name: 'Fraunces', weights: ['500 700'], styles: ['normal'], preload: true }` + entrée `styles: ['italic']` sans préchargement ; Figtree sans préchargement ; `font-display: swap` à vérifier. Si Google ne sert pas le variable : précharger la seule graisse du `h1` de chaque gabarit.

**L2** — Module local `modules/auth-differee.ts` : au hook `app:resolve`, retirer le plugin `session.client` du module et le middleware global `auth` en **mémorisant son chemin**, et **faire échouer le build** si l'un n'est pas trouvé (version épinglée 0.3.12 : une montée de version doit échouer bruyamment). Middleware enveloppe qui n'importe la garde (`import()` dynamique) que si la route a une règle `auth` (même logique que `auth.global.js:92-107`, `#auth/route-rules` + `radix3`). Sur les pages `ssr: false` du studio, le middleware appelle déjà `fetchSession` (`auth.global.js:41-45`). `useTarifsAffichage.ts` : retirer `useUserSession`, `lienPayant` pointe toujours vers `/studio/compte?periode=…#abonnement` (la garde renvoie un visiteur vers `/connexion`). Hors périmètre : `session.server` (TTFB < 100 ms).

**L3** — `index.vue` : `MarketingEntete` et `MarketingHero` normaux ; `LazyMarketingTrouve/Compris/Contact/PourQui/Tarifs/Faq/Cloture` avec `hydrate-on-visible` ; `LazyMarketingPied` en `hydrate-never` s'il n'a aucune interactivité. Le HTML reste rendu serveur (aucune perte SEO). Même lot : état initial des effets d'apparition sous 961 px posé **en CSS dès le serveur** (`@media (max-width: 960px)` et `prefers-reduced-motion: no-preference`), pas au montage (supprime le clignotement). Extraction des styles de `Trouve.vue` seulement si la mesure montre un CSS en ligne volumineux.

**L4** — `Nav.vue` : `menuDemande = ref(false)`, rendu `<LazyUSlideover v-if="menuDemande" v-model:open="menuOuvert">` ; focus rendu au bouton à la fermeture. `[username]/index.vue` : `LazyAgendaPublic`, `LazyVitrineALaUne`, `LazyVitrineTemoignageALaUne` en `hydrate-on-visible`. `services/[slug].vue` : `LazyAgendaCreneauxProchains`, `LazyReservationDemandeForm` en `hydrate-on-visible`, `LazyServiceAutres` en `hydrate-never` s'il ne contient que des liens (à vérifier). **Îlots serveur et `noScripts` écartés** (casseraient l'agenda, les formulaires, le menu, le suivi des vues).

**L5** — `ui: { colorMode: false, experimental: { componentDetection: true }, theme: { colors: ['primary', 'error'] } }`. Avant de réduire `theme.colors`, chercher `color="secondary|success|info|warning|neutral"` dans `app/` (y compris `:actions`, ex. `tarifs.vue:42`). Comparer « Nuxt UI detected N components » et faire un tour visuel du studio et de l'admin. Pas de CSS critique sauf si `entry.css` > 30 Ko brotli après L5 et `render-blocking` non nul.

**L6** — `app.vue:48` → `<LazyInstallPrompt v-if="!hoteAdmin && cheminAutorise(route.path)" hydrate-on-idle />` ; dans `usePwaInstall.ts:249-257`, n'enregistrer le service worker que si `cheminAutorise(location.pathname)`, dans un `requestIdleCallback` ; message « nouvelle version » sous la même condition. Conséquence à dire : les visites de vitrine ne comptent plus pour la règle « deuxième visite » (conforme à S15).

**L8** — Diagnostiquer d'abord (`largest-contentful-paint-element` et chronologie de la requête `/medias/…`). Variante générée à froid : préchauffer `/medias/{id}/{w}.webp` dans le workflow avant `lhci` (comme le cache nginx d'un an en production) et **le déclarer** dans `lighthouserc.cjs` et le rapport. `srcset` surdimensionné : ajuster `sizes`. Initiale : voir L1.

**L9** — Mesurer le document (octets bruts, part de `__NUXT_DATA__`). Si > ~30 Ko : (a) **recommandé** : mesurer derrière nginx en CI (h2, gzip, comme la production) ; (b) compression du HTML dans Nitro (bibliothèque maintenue, règle 4.12). Agenda de l'accueil : fenêtre de 7 jours si l'accueil n'affiche pas l'agenda complet (supposé).

**L10** — `/_nuxt/` : `proxy_hide_header Cache-Control;` avant `add_header`, ou supprimer l'`add_header` si Nitro pose déjà `immutable` ; `/_fonts/` : `immutable` si les noms sont empreintés ; **`/landing/` : `public, max-age=86400, stale-while-revalidate=604800`, jamais `immutable`** ; `/_ipx/` : `image.ipx.maxAge` ; pas de `gzip` sur ce que Nitro précompresse.

## 3. Plan de mesure

1. **Mesure de départ sans build** : extraire des `lhr-*.json` du dernier run (artefact `seo-perf`, dossier `.lighthouseci/`) : `resource-summary`, `network-requests`, `largest-contentful-paint-element`, `bootup-time`, `unused-javascript`, `first-contentful-paint`, TBT, score, pour chacune des 4 pages.
2. **Analyse du bundle** (un seul agent, une fois, sous `flock`, ~15-20 min) : `nuxi analyze --no-serve` avec les variables d'environnement factices de CI ; relever taille brute/gzip/brotli de l'entrée, 15 plus gros modules, présence de `better-auth`, `nanostores`, `@better-fetch`, `dayjs`, `zod`, `reka-ui`, `@iconify`, code PWA ; nombre de `modulepreload` par page.
3. **Lighthouse local** : `pnpm perf:local` (build + `lhci autorun`), ou `pnpm perf` sans rebuild ; médiane de 3 passages ; compléments `curl` (taille du document, `modulepreload`, `as="font"`, en-têtes d'un asset en `Accept-Encoding: br`).
4. **Protocole** : un lot = leviers sur des pages disjointes ; lot A : L7 + L2 + L6 ; lot B : L1 + L5 ; lot C : L3 (`/`) + L4 (vitrines) ; lot D : L8 + L9 ; lot E : L11 si nécessaire. Un build par lot ; un lot sans gain mesuré est **retiré**. Tableau par lot et par page : JS transféré/brut, CSS transféré, requêtes avant FCP, document, FCP, LCP, TBT, score.
5. **Double mesure** : Node seul et derrière nginx en CI (h2, TLS auto-signé, gzip, mêmes fichiers `deploy/nginx`), déclarée dans `lighthouserc.cjs` et le rapport.

## 4. Tâches (agents, périmètres de fichiers disjoints)

| Tâche | Agent | Fichiers modifiés (exclusifs) | Ne touche PAS | Dépend de |
|---|---|---|---|---|
| T0 Mesure de départ | moi/devops | aucun fichier du dépôt (résultats dans le rapport) | tout | — |
| T1 Configuration, authentification, PWA | frontend | `nuxt.config.ts`, `package.json`, `pnpm-lock.yaml`, `docs/bibliotheques.md`, `modules/auth-differee.ts`, `app/composables/useTarifsAffichage.ts`, `app/app.vue`, `app/composables/usePwaInstall.ts`, `tests/unit/auth-differee.test.ts` | `app/pages/**`, `app/components/**`, `deploy/**`, `lighthouserc.cjs`, `.github/**` | T0 |
| T2 Landing | frontend | `app/pages/index.vue`, `app/components/marketing/{Trouve,Compris,Contact,PourQui,Faq,Tarifs,Cloture,Pied}.vue` | `nuxt.config.ts`, `app.vue`, composables, `vitrine/**`, `[username]/**` | T0 (parallèle à T1, T3) |
| T3 Vitrines | frontend | `app/components/vitrine/Nav.vue`, `app/pages/[username]/index.vue`, `app/pages/[username]/services/[slug].vue` (+ `ServiceVisuel.vue` si L8 = `sizes`) | `marketing/**`, `nuxt.config.ts`, composables | T0 (parallèle) |
| T4 Nginx, CI, Lighthouse | devops | `deploy/nginx/brandself-location.conf`, `deploy/nginx/brandself-public.conf.exemple` (nouveau), `lighthouserc.cjs`, `.github/workflows/ci.yml` | `app/**`, `nuxt.config.ts` | T0 ; passage en `error` après T5 |
| T5 Garde-fous | tester | `tests/unit/couleurs-composees.test.ts` (nouveau), test de cohérence `lighthouserc.cjs` ↔ `shared/seo.ts` étendu aux budgets de poids | code applicatif | T1 à T3 |
| T6 Mesure par lot et rapport | un seul agent | aucun | — | T1 à T4 |
| T7 Revue | reviewer + regression-checker + ux-reviewer | — | — | T6 |

## 5. Critères d'acceptation (Given/When/Then)

- **CA1** Given le build de production, When `pnpm perf` mesure `/`, `/tarifs`, `/dr-cabrel` et `/dr-cabrel/services/consultation-de-cardiologie` (3 passages, médiane), Then `categories:performance` ≥ 0,85 et `largest-contentful-paint` ≤ 2 500 ms sur chaque page, ces assertions étant en `'error'` dans `lighthouserc.cjs`.
- **CA2** Given le job `seo-perf`, When il s'exécute sur la branche, Then il est vert avec ces assertions en `error` ; sortie brute collée dans le rapport.
- **CA3** Given `lighthouserc.cjs`, Then il contient `resource-summary:script:size` ≤ `BUDGET_JS_KO*1024` et `resource-summary:total:size` ≤ `BUDGET_PAGE_KO*1024`, vérifiés égaux à `shared/seo.ts:187-188` par un test unitaire. Si le budget JS est inatteignable : §6, jamais retouché en silence.
- **CA4** Given un visiteur sans cookie, When il charge `/`, `/tarifs` ou `/dr-cabrel`, Then aucun JS téléchargé ne contient `better-auth`, `emailOtp` ni `phoneNumber`, et aucune requête `/api/auth/get-session` n'est émise.
- **CA5** Visiteur non connecté sur `/tarifs` qui navigue vers `/studio` → arrive sur `/connexion` (avec `?redirect=` si la garde l'ajoute).
- **CA6** Utilisateur connecté qui recharge `/studio/services` (`ssr: false`) → la page s'affiche avec ses données, sans passer par `/connexion`.
- **CA7** Utilisateur connecté qui ouvre `/connexion` → redirigé vers `/studio`.
- **CA8** Session expirée côté serveur, navigation dans le studio → renvoi vers `/connexion` (inchangé).
- **CA9** Montée de version de `@nuxtjs/better-auth` qui renomme le plugin ou le middleware → `pnpm build` échoue avec un message explicite du module `auth-differee`.
- **CA10** `paiementEnLigne = true` : visiteur qui clique « Passer au plan payant » → `/connexion` ; utilisateur connecté → `/studio/compte?periode=N#abonnement`.
- **CA11** Visiteur à sa 2e session sur `/dr-cabrel` → aucun service worker enregistré par cette page, aucun `[data-pwa-install]`, aucun chunk d'`InstallPrompt` téléchargé.
- **CA12** Visiteur à sa 2e session sur `/tarifs`, 4 s sans saisie → la fenêtre d'installation peut apparaître ; e2e S15 existants verts sans modification.
- **CA13** `/` rendu au serveur, HTML lu sans JS → textes de Être trouvé, Être compris, Être contacté, Pour qui, Tarifs et FAQ présents ; `pnpm e2e:seo` vert.
- **CA14** `/` à 390 px → aucun élément animé visible puis masqué : état initial posé par CSS au rendu serveur (captures avant et après hydratation identiques au-dessus de la ligne de flottaison).
- **CA15** FAQ ouvrable après défilement (hydratée à la visibilité) ; `prefers-reduced-motion: reduce` → aucun effet.
- **CA16** `/dr-cabrel` à 390 px : « Menu » ouvre le volet (chargé au premier clic), Échap le ferme, le focus revient au bouton ; au premier chargement aucun chunk du Dialog/Slideover téléchargé.
- **CA17** Parcours de réservation e2e existant (agenda de `/dr-cabrel`) passe sans modification.
- **CA18** Formulaire de demande du détail d'un service : l'e2e existant passe.
- **CA19** `entry.*.css` plus petit après L5 (valeur collée) ; studio et admin parcourus en e2e sans composant sans style (axe et captures verts).
- **CA20** HTML de `/` : au plus 2 `<link rel="preload" as="font">` ; CLS ≤ 0,1.
- **CA21** `curl -sI` sur un `/_nuxt/*.js` avec `Accept-Encoding: br` → un seul `Cache-Control: public, max-age=31536000, immutable`, `Content-Encoding: br`, `Vary: Accept-Encoding` ; `/landing/doc.jpg` sans `immutable` ; HTML compressé avec `gzip` ; `nginx -t` passe sur les fichiers du dépôt.
- **CA22** Test `couleurs-composees` : échoue sur tout utilitaire `(text|bg|border|ring|fill|stroke|from|via|to)-<couleur>/<NN>` ou `color-mix(` en `color`/`background` hors variantes d'état (`hover:`, `focus:`, `focus-visible:`, `active:`, `group-hover:`, `disabled:`), sur l'arbre des 4 pages mesurées.
- **CA23** Fixture fautive (`text-encre/80`) → le test échoue ; fixture conforme (`hover:bg-[color-mix(…)]`) → passe.
- **CA24** Exceptions justifiées (ex. `service/ServiceVisuel.vue:34` `bg-fond/20`, décoratif) dans une liste explicite fichier + utilitaire + raison ; une entrée devenue introuvable fait échouer le test.
- **CA25** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm e2e:seo` verts, `skipped = 0`, accessibilité Lighthouse ≥ 0,95, SEO ≥ 0,92, bonnes pratiques ≥ 0,9 sur les 4 pages ; sorties brutes collées.

## 6. Risques et objectif réaliste

- **Estimation (supposée, à confirmer)** : `/tarifs` et `/dr-cabrel` : LCP plausible de 2,2 à 3,0 s, score de 0,80 à 0,90 après L1, L2, L4, L5, L6, L7 (le socle Vue/Nuxt/unhead/`@nuxt/ui` et les allers-retours HTTP/1.1 sont incompressibles) ; `/` : 2,5 à 3,5 s ; détail d'un service : dépend du diagnostic L8. Budget JS de 200 Ko **transférés** probablement atteignable ; 200 Ko **bruts** non.
- **Biais de la mesure en CI** : Node en HTTP/1.1 sans h2 ni compression du HTML, alors que la production a nginx avec h2 et gzip. Si un budget échoue après tous les leviers : (a) **recommandé** : lancer `lhci` à travers un nginx de CI (h2, TLS auto-signé, gzip, mêmes fichiers `deploy/nginx`), sans toucher à la simulation 4G lente ni au CPU x4, déclaré dans `lighthouserc.cjs` et le rapport ; (b) à défaut, des budgets **par type de page** fixés et justifiés dans `shared/seo.ts`, décision posée dans `PROJECT_STATE.md`. Jamais : abaisser 0,85 ou 2 500 ms, ni retirer le CPU x4, en silence.
- **Risque n°1 : L2** (détails internes du module) : version épinglée, échec du build (CA9), e2e de connexion. **Risque n°2 : L5** (styles manquants studio/admin) : liste explicite `componentDetection`, parcours e2e. **Risque n°3 : L3/L4** : un composant `hydrate-never` qui contient en réalité un `@click` (FAQ, Tarifs) : relire avant de choisir la stratégie ; CA15 à CA18.

## 7. CHALLENGE

- **Hypothèses implicites** : la mesure CI ne représente pas la production (H1) ; le coût principal d'un LCP texte rendu au serveur vient des préchargements concurrents (JS, polices), pas de l'hydratation (d'où L1 en tête).
- **Angles morts** : `get-session` probable à chaque vue de vitrine (D2) ; service worker enregistré sur les vitrines (D5, contraire à CLAUDE.md §10) ; `/landing/` non empreinté (`immutable` interdit) ; le cache HTTP n'améliore pas Lighthouse (chargement à froid) ; « FCP 7 s sur `/tarifs` » incohérent avec un LCP de 4,4 s (H2) ; le `Content-Signal` (SEO 0,92) est hors sujet.
- **À retirer ou ne pas faire** : pas d'îlots serveur ni de `noScripts` sur les vitrines ; pas de CSS critique ni de `manualChunks` « au jugé » ; ne pas retirer `UApp` ; ne pas toucher à `session.server` ; ne pas mélanger le remplacement des photos licenciées de la landing (partie C) avec la performance, sauf poids et dimensions.
- **Périmètre réel** : fichiers oubliés par le brief : `useTarifsAffichage.ts`, `usePwaInstall.ts`, `vitrine/Nav.vue`, un module local `modules/`, le bloc `server` nginx public (absent du dépôt), le test de cohérence des budgets. Bibliothèques citées sans objet côté client : `@js-temporal/polyfill`, `libphonenumber-js`, `ua-parser-js`, `isbot`, `qrcode`, `sortablejs` (à confirmer par `nuxi analyze`). Inutiles : `dayjs-nuxt` (partie de ce sprint), `nuxt-phosphor-icons` dans `package.json:60` (hors périmètre).

## 8. Mesure de départ (extraite des `lhr-*.json` du run CI 44125415956, 3 passages, médiane, 2026-11-17)

| Page | Perf | FCP (ms) | LCP (ms) | TBT (ms) | JS transféré / brut (Ko) | CSS transféré (Ko) | Document (Ko) | Polices (Ko) | Images (Ko) | Requêtes (dont scripts) | JS inutilisé (Ko) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 0,61 | 5 574 | 7 733 | 100 | 227 / 731 | 31 | 105 | 101 (3) | 294 | 101 (35) | 22 |
| `/tarifs` | 0,66 | 5 118 | 5 522 | 94 | 275 / 914 | 31 | 34 | 56 (2) | 9 | 104 (62) | 49 |
| `/dr-cabrel` | 0,58 | 6 711 | 7 236 | 162 | 249 / 753 | 26 | 73 | 101 (3) | 4 | 101 (51) | 23 |
| `/dr-cabrel/services/consultation-de-cardiologie` | 0,61 | 5 293 | 8 660 | 116 | 282 / 899 | 26 | 61 | 56 (2) | 1 | 113 (65) | 49 |

Constats :
- Le poids **transféré** est modeste (CSS 26-31 Ko, JS 227-282 Ko) : le coût dominant est le **nombre de requêtes** (~100 par page, 35 à 65 fichiers JS) en HTTP/1.1 (6 connexions) avec 150 ms de latence simulée. La mesure derrière nginx en h2 (§6 a) devient prioritaire pour savoir quelle part est du protocole et quelle part est du code.
- D2 confirmé : `/api/auth/get-session` est appelé sur les 4 pages. D5 confirmé : au moins une requête PWA (`sw.js`, manifest ou `offline`) sur les vitrines.
- Le document de `/` pèse 105 Ko transférés (non compressé) : payload `__NUXT_DATA__` et HTML de la landing à mesurer (L9). Les images de `/` pèsent 294 Ko (dont la capture `vit-d.jpg`, ~141 Ko).
- L'audit `largest-contentful-paint-element` n'a pas de détail exploitable dans ces rapports : le diagnostic de L8 passe par une mesure ciblée (voir T6).
