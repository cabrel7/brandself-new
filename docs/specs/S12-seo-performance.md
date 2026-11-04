# Spec S12 : SEO, GEO et performance

À écrire dans `docs/specs/S12-seo-performance.md`. Branche `sprint/s12-seo`, tier **standard**. Aucun sujet d'auth, de paiement ou de données personnelles n'est touché, donc pas d'escalade en tier critique. S12 passe **avant S11**. Les décisions reprennent à **#135**.

## Sources lues (et non lues)

**Lu en entier** :
- CLAUDE.md, PROJECT_CONTEXT.md, PROJECT_STATE.md (dont §7 « Avant mise en prod » et la dette S8 à S10)
- SPRINTS.md : BLOC COMMUN, S3, S4, S11, S12, S13
- docs/specs/S10-abonnements.md (format repris)
- nuxt.config.ts, package.json
- `@nuxtjs/seo` 6.0.1 (`dist/module.mjs`)
- `nuxt-ai-ready` 3.4.0 : `module.d.mts`, `runtime/types.d.ts` (options), `llms.txt.get.js`, `llms-txt-utils.js`, valeurs par défaut du module
- app/app.vue, app/error.vue, app/pages/index.vue
- app/pages/[username]/{index, services/index, services/[slug], realisations/index, realisations/[slug], agenda, contact, reserver, reserver/confirmation}.vue, app/pages/@[username].vue
- app/composables/usePublicVitrine.ts
- server/services/vitrines.ts, server/services/plan-visibilite.ts, server/config/plans.ts, server/resources/vitrine.ts
- server/api/public/[username]/index.get.ts
- shared/dto/vitrine.ts
- shared/db/schema.ts (médias, vitrines, services, réalisations, témoignages, liens)
- public/_robots.txt

**Versions installées vues dans node_modules/.pnpm** : @nuxtjs/robots 7.0.2, @nuxtjs/sitemap 9.1.0, nuxt-og-image 7.0.7, nuxt-schema-org 7.0.1, nuxt-seo-utils 9.0.1, nuxt-site-config 5.0.3, nuxt-link-checker 6.0.1, nuxt-skew-protection 2.0.3, nuxt-ai-ready 3.4.0.

**Non lus faute de tours.** Ce sont les hypothèses H1 à H12 ci-dessous, que le **lot A vérifie avant tout code** :
- app/components/vitrine/{Cadre, Hero, Nav, Pied, Photo, ServicesALaUne, ALaUne, TemoignageALaUne, EnLigne}.vue
- app/pages/tarifs.vue, app/layouts/studio.vue
- server/routes/medias/[id]/[fichier].get.ts et le service médias (variantes sharp)
- deploy/nginx/brandself-location.conf, .github/workflows/ci.yml
- les ressources service et réalisation (format `seo.titre`)
- shared/reserved.ts, shared/schemas/vitrine.ts
- les maquettes PNG

---

## 1. CHALLENGE

**Hypothèses implicites du brief**
- **« Le SEO est à construire. »** Faux en partie : `@nuxtjs/seo` 6.0.1 est déjà **actif en production**. Il n'est coupé qu'en `$development` (ogImage, linkChecker, aiReady, sitemap, robots).
  - On a donc déjà en production, **sans aucune configuration** : `nuxt-ai-ready` 3.4.0 (`/llms.txt`, négociation Markdown pour les robots, index d'agent skills, en-tête `Link: describedby`), `nuxt-skew-protection` 2.0.3 (interrogation côté client) et `nuxt-og-image` 7.0.7.
  - S12 consiste surtout à **configurer et maîtriser** ce qui tourne déjà, pas à ajouter des modules.
- **« La description sera générée par l'IA, et il faut un champ. »** Les colonnes `vitrines.seo_titre` et `seo_description` **existent depuis la migration 0002**.
  - `toVitrinePublicResource` les lit déjà, avec le repli `accroche` puis le gabarit `Nom, métier à ville.`.
  - Aucun écran ne les renseigne. **Aucune migration n'est nécessaire.**
- **« Un cache par page avec invalidation à chaque modification. »** Ce brief suppose qu'un cache HTML rapporte beaucoup. Or Brandself est une **longue traîne** : des milliers de vitrines peu visitées chacune. Le taux de succès d'un cache par URL sera faible.
  - Le vrai coût vient des robots, qui parcourent chaque page une fois : aucun cache n'aide.
  - Le vrai risque vient des **rafales** (une vitrine partagée dans un groupe WhatsApp).
  - Une invalidation exacte sur une page HTML en cache coûte cher : il faudrait la purge nginx (module absent de nginx standard) ou dépendre du format interne des clés de cache de Nitro (hachage, chemin tronqué à 16 caractères, donc fragile à chaque mise à jour).
- **« Les tests de balises en e2e. »** Sitemap, robots et aiReady sont **coupés en dev**, et Playwright tourne aujourd'hui sur `nuxt dev`. Les tests SEO doivent donc tourner sur le **build de production**. Sinon ils testent une configuration qui n'existe pas en ligne.

**Angles morts**
1. **L'accueil d'une vitrine contient des données qui dépendent du temps** : prochain créneau, agenda (`usePublicAgenda` pendant le rendu serveur), masquage S10 à l'échéance d'un abonnement. Une page en cache affiche des créneaux périmés et un contenu masqué ou démasqué en retard. Il faut une durée de cache très courte, plus un rafraîchissement de l'agenda côté navigateur.
2. **`nuxt-ai-ready` par défaut** :
   - la négociation Markdown sur les routes HTML entre en conflit avec tout cache (le module avertit et se coupe route par route) ;
   - `llms.txt` lirait **tous les sitemaps à l'exécution** (toutes les vitrines) ;
   - `agentSkills` publie tout dossier `skills/` du dépôt.
   Il faut tout fixer explicitement.
3. **Casse et barre finale** : `getPublicVitrine` normalise le username en minuscules. Donc `/Dr-Cabrel` et `/dr-cabrel/` rendent la même page que `/dr-cabrel` : contenu dupliqué. Il faut une redirection 301.
4. **Changement d'adresse** (`changeUsername`) : l'ancienne URL renvoie 404, sans historique, donc sans redirection possible. Corriger demande une table, donc une migration : hors S12 (Q3).
5. **`/@username`** (link-in-bio) : contenu mince, qui double l'accueil sur la requête « nom ». À ne pas indexer.
6. **Données structurées trompeuses** : les témoignages sont choisis par le professionnel, sans note. `Review` et `AggregateRating` seraient des avis « auto-déclarés », non éligibles chez Google et trompeurs. À exclure. De même, `ProfessionalService` (une forme de `LocalBusiness`) sans adresse postale ne donne pas de résultat enrichi, et le métier est un texte libre (un médecin n'est pas un « ProfessionalService »).
7. **Image de partage `nuxt-og-image`** : rendu satori/resvg en direct (CPU et environ 100 Mo par rendu), polices téléchargées au build (déjà constaté en dev), secret `NUXT_OG_IMAGE_SECRET` requis en production (le module le contrôle). Sur 7 Go avec des builds de 10 à 19 min, c'est le poste le plus risqué pour un gain faible : WhatsApp et Facebook affichent déjà titre et description sous l'image.
8. **`public/_robots.txt`** (`Disallow:` vide) alimente le module robots : il faut le remplacer par la configuration.
9. **S11 (vue)** : l'envoi d'une « vue » doit rester un POST côté navigateur, hors HTML. Sinon le cache le compterait une fois par rendu, ou ne le compterait jamais.

**Meilleure approche (retenue)**
1. **Cache HTML en microcache nginx de 10 s, « stale-while-revalidate », sur liste blanche** : Nitro envoie `X-Accel-Expires` seulement sur les pages publiques autorisées. Aucune purge. « Visible en ligne en quelques secondes » est garanti par la borne de 10 s. L'état dépendant du temps (abonnement, grâce) est rattrapé en 10 s au plus, sans tick du worker. Aucun cache côté application (pas de Redis) en S12 : rien à oublier d'invalider dans 15 services d'écriture. À rouvrir si le test de charge de S13 le justifie (Q1).
2. **Image de partage = variante `partage` 1200×630 JPEG de la photo** (de l'image du service ou de la réalisation sur leur page), générée par `sharp`, déjà adopté. `nuxt-og-image` est **désactivé partout**. Repli : une image statique Brandself.
3. **SEO par composable** (`useSeoVitrine`) et par **fonctions pures** (titres, descriptions, graphe schema.org), testables en unitaire. Les modules gardent leur rôle : canonique, sitemap, robots, schema-org, llms.txt.
4. **GEO, les deux lectures, à faible coût**
   - **(a) moteurs de réponse IA** :
     - `llms.txt` par `nuxt-ai-ready` configuré, avec `pages: false` (aucune lecture des sitemaps) ;
     - JSON-LD riche et honnête ;
     - politique explicite des robots d'IA, en configuration : robots de recherche et de réponse autorisés, robots d'entraînement interdits par défaut, plus `Content-Signal` ;
     - contenu citable (un seul h1, sous-titres, adresse ville et pays en texte).
   - **(b) SEO local** :
     - métier et ville dans le titre et la description ;
     - `address` et `areaServed` (City, Country) dans le JSON-LD ;
     - `og:locale` `fr_CM` ou `fr_FR` selon le pays ;
     - `lang="fr"` ;
     - pas de hreflang (une seule langue, aucune alternative : le hreflang n'aurait aucun sens).
5. **Tests SEO, Lighthouse et axe sur le build de production**, dans un job CI dédié, manuel et sur PR vers `main`.

**À retirer ou simplifier**
- Exclus : `nuxt-og-image` (désactivé), négociation Markdown, `llms-full.txt`, `sitemap.md`, MCP, agent skills, catalogue d'API, `llms.txt` par vitrine (aucun emplacement standard).
- Exclus : `Review` et `AggregateRating`, `ProfessionalService`.
- « Une carte par vitrine » : remplacé par **une carte `vitrines` paginée** (lots d'URL) dans l'index. 10 000 vitrines donneraient 10 000 fichiers et 10 000 requêtes pour l'index, sans gain.
- Génération IA de la description : remplacée par un **repli déterministe** qui contient métier et ville (meilleur pour « métier + ville »), plus un champ modifiable au Profil. L'IA viendra plus tard (Q4).
- `nuxt-skew-protection` : désactivé par défaut. Il ajoute du JavaScript et des requêtes d'interrogation sur les pages publiques (à confirmer, H9).

**Périmètre réel vs demandé**
En plus du brief :
- redirections canoniques (casse, barre finale) ;
- en-têtes de cache des médias ;
- rafraîchissement de l'agenda au montage ;
- hydratation paresseuse sous la ligne de flottaison ;
- section « Sur Google » du Profil ;
- dette S10 « médias d'un élément masqué » (documentée, non traitée) ;
- configuration nginx (microcache, gzip, HTTP/2, en-têtes de base) ;
- Playwright sur le build de production.

Reportés à S13 : CSP et HSTS complets.

**Changements par rapport au brief littéral** : #138 (cache nginx de 10 s au lieu d'une invalidation explicite), #147 (image de partage par `sharp`, pas `nuxt-og-image`), #150 (carte paginée au lieu d'une carte par vitrine), #144 (pas d'IA pour la description en S12), #156 (pas d'avis ni de note dans le JSON-LD).

---

## 2. Hypothèses à vérifier en lot A (avant tout code, résultat consigné dans le rapport)

| # | Hypothèse | Si elle est fausse |
|---|---|---|
| H1 | Production = **1 processus Nitro** + 1 worker sous PM2 (PROJECT_CONTEXT §12). Le microcache nginx ne dépend pas de ce nombre | rien à changer (choix nginx) |
| H2 | nginx ≥ 1.25.1 sur le VPS (`http2 on;`), avec les modules `proxy_cache` et `gzip` standard | syntaxe `listen 443 ssl http2;` |
| H3 | `@nuxtjs/sitemap` 9.1.0 accepte `sitemaps: { vitrines: { sources: [...], chunks: N } }` et `cacheMaxAgeSeconds` | repli : `sitemaps.vitrines.sources` non découpé, ou routes `server/routes/sitemap/vitrines-[page].xml.ts` (dernier recours, à justifier) |
| H4 | `@nuxtjs/robots` 7.0.2 accepte `groups: [{ userAgent: [...], disallow: [...] }]`, `sitemap`, et `robots` dans `routeRules` (meta + `X-Robots-Tag`) | `useSeoMeta({ robots })` page par page + en-tête dans le plugin B |
| H5 | `nuxt-site-config` 5.0.3 lit `NUXT_PUBLIC_SITE_URL` ou `NUXT_SITE_URL` pour `site.url` ; `nuxt-seo-utils` 9.0.1 émet la canonique automatiquement (sans query) et accepte `titleTemplate` surchargé par page | `useHead({ link: [{ rel: 'canonical' }] })` dans `useSeoVitrine` |
| H6 | `nuxt-schema-org` 7.0.1 : `useSchemaOrg`, `definePerson`, `defineService`, `defineBreadcrumb`, `defineWebPage`, `identity` dans la configuration, `@id` personnalisés | nœuds bruts typés, comme `realisations/[slug].vue` aujourd'hui |
| H7 | La route médias sert des variantes `sharp` nommées ; un média n'est **jamais réécrit sous le même id** (donc `immutable` possible) | `max-age=86400` sans `immutable` |
| H8 | `MediaDTO` porte déjà `url`, `srcset`, `largeur`, `hauteur` ; `@nuxt/image` (IPX) n'est utilisé nulle part (`NuxtImg` absent) | garder les `<img>` natifs ; retirer `@nuxt/image` seulement si aucun usage (Q9) |
| H9 | `nuxt-skew-protection` (`updateStrategy: polling`) ajoute un greffon client sur toutes les pages | si négligeable (< 2 Ko, aucune interrogation sur les pages publiques), le garder |
| H10 | `Cadre`, `Hero` et les pages publiques ne rendent **qu'un h1** ; `Hero` affiche la photo en LCP | corriger en lot C |
| H11 | Le schéma de mise à jour du Profil (`shared/schemas/vitrine.ts`) accepte déjà `seoTitre` et `seoDescription` (le test `schemas-vitrine.test.ts:92` les cite) | ajouter les deux champs (lot A) |
| H12 | CI : un job build existe dans `.github/workflows/ci.yml` et produit `.output` (artefact réutilisable) | le job `seo-perf` fait son propre build (+12 à 19 min, déclenchement manuel seulement) |
| H13 | Nom du cookie de session Better Auth en production : `__Secure-better-auth.session_token` | adapter la `map` nginx (motif `session_token`) |

---

## 3. Décisions par défaut (#135 à #166)

| # | Sujet | Décision |
|---|---|---|
| 135 | GEO, double lecture | (a) moteurs de réponse IA : `llms.txt`, JSON-LD, robots et `Content-Signal`, contenu citable ; (b) local : métier et ville dans titre et description, adresse et zone servie en JSON-LD, `og:locale` par pays. Les deux sont traitées, à faible coût. |
| 136 | Bibliothèque d'abord | Aucun nouveau module Nuxt. Deux devDependencies seulement : `@lhci/cli` (Lighthouse CI) et `@axe-core/playwright` (axe), à noter en CLAUDE.md §8. |
| 137 | `site` | `site: { url: NUXT_PUBLIC_SITE_URL (validée par shared/env.ts), name: 'Brandself', description: SITE_DESCRIPTION, defaultLocale: 'fr', trailingSlash: false, indexable: true }`. Hors production (`NUXT_PUBLIC_SITE_ENV !== 'production'`, à confirmer), `indexable: false` : la préproduction est en noindex partout. |
| 138 | Cache HTML | **Microcache nginx**. Clé `$scheme$host$uri` (la query est ignorée : les pages en cache ne la lisent pas). `proxy_cache_valid` piloté par `X-Accel-Expires: CACHE_HTML_TTL_S (10)`, envoyé **seulement** par Nitro, seulement pour : méthode GET/HEAD, statut 200, route sur la liste blanche (#139), aucun `Set-Cookie` dans la réponse. `proxy_cache_use_stale updating error timeout http_500 http_502 http_503`, `proxy_cache_background_update on`, `proxy_cache_lock on` (un seul rendu par URL en rafale). `inactive=10m` borne le repli en cas d'erreur. Contournement et non-mise en cache si un cookie de session est présent (`map $http_cookie` sur `session_token`). `add_header X-Cache-Status $upstream_cache_status`. Le navigateur reçoit `Cache-Control: no-cache` (toujours revalidé). Aucun cache côté application en S12. |
| 139 | Liste blanche du cache | `CACHE_HTML_ROUTES` : `/`, `/tarifs`, `/:username`, `/:username/services`, `/:username/services/:slug`, `/:username/realisations`, `/:username/realisations/:slug`, `/@:username`. **Jamais** : `/studio/**`, `/onboarding`, `/connexion/**`, `/desabonnement`, `/:username/reserver/**` (dont la confirmation, déjà `private, no-store`), `/:username/agenda`, `/:username/contact`, `/api/**`, pages d'erreur (4xx, 5xx). |
| 140 | Données dépendant du temps | (1) La borne de 10 s absorbe les bascules d'abonnement (actif, grâce, gratuit), sans tick. (2) `usePublicAgenda` reçoit l'option `rafraichirAuMontage` : l'accueil et le détail d'un service relancent les créneaux après l'hydratation (non bloquant, hauteur réservée, aucun décalage de mise en page). La réservation reste protégée côté serveur (contrainte d'exclusion). |
| 141 | Jamais de cache d'un état utilisateur | Trois verrous indépendants : liste blanche Nitro (#139) ; nginx ne met pas en cache une réponse avec `Set-Cookie` ni une requête avec cookie de session ; `Cache-Control: private, no-store` respecté (aucun `proxy_ignore_headers Cache-Control`). |
| 142 | Compatibilité S11 | La vue sera un `POST /api/public/:username/vue` envoyé **après le chargement** (`requestIdleCallback`, puis `fetch` avec `keepalive`), jamais pendant le rendu serveur. `/api/**` n'est jamais en cache et reste interdit dans robots.txt. Budget JavaScript avec une marge de 3 Ko gzip réservée. S12 n'y touche pas. |
| 143 | Titres | Vitrine : `{nomAffiche} — {metier} à {ville}`. Liste des services : `Services — {nomAffiche}, {metier} à {ville}`. Détail d'un service : `{service} — {nomAffiche} — {ville}`. Liste des réalisations : `Réalisations — {nomAffiche}, {metier} à {ville}`. Détail d'une réalisation : `{réalisation} — {nomAffiche}`. Link-in-bio : `{nomAffiche} — liens`. **Pas de suffixe « Brandself » sur les vitrines** (`titleTemplate: '%s'`). Pages Brandself : `%s · Brandself`, et l'accueil `/` = `Brandself — votre vitrine en ligne`. `seo_titre`, s'il est renseigné, remplace le titre de l'accueil de la vitrine seulement. |
| 144 | Description | `seo_description ?? construireDescriptionVitrine(...)`. Fonction pure (`shared/seo.ts`) : `{metier} à {ville} ({paysLibelle}).` puis `{accroche}`, ou à défaut le début de la `bio`, tronquée à `SEO_DESCRIPTION_MAX = 160` sur une fin de mot avec « … ». Service : `seo_description du service`, sinon la description du service tronquée, sinon `{service} avec {nomAffiche}, {metier} à {ville}.` Réalisation : idem. **Pas d'IA en S12** (Q4). Aucune migration. |
| 145 | Saisie dans le Profil | Section « Sur Google » du Profil : « Titre sur Google » (facultatif, 30 à 70 caractères, compteur) et « Description sur Google » (facultative, 50 à 160, compteur). Aperçu du résultat Google (texte seul). Mention « Laissez vide : nous l'écrivons pour vous à partir de votre métier, de votre ville et de votre accroche. » Bouton « Revenir à la version automatique ». Zod : chaîne vide traitée comme `null`. |
| 146 | Canonique et redirections | `server/middleware/canonique.ts` (GET/HEAD seulement). Si le premier segment ressemble à un username (`/^@?[A-Za-z0-9-]{3,30}$/`) et n'est pas réservé : **301** vers le chemin en minuscules et sans barre finale, query conservée. Exclus : `/api`, `/_nuxt`, `/medias`, `/__*`, les fichiers (point dans le dernier segment), `/studio`, `/connexion`, `/onboarding`. Balise canonique absolue (`site.url` + chemin, sans query) sur toutes les pages indexables. |
| 147 | Image de partage | **`nuxt-og-image` désactivé** (`ogImage: { enabled: false }` dans la configuration de base). `og:image` 1200×630 JPEG, variante `partage` générée par `sharp` (recadrage `cover`, `position: 'north'` pour une photo de profil, qualité 82, EXIF retiré). Accueil, liste et link-in-bio : photo de la vitrine. Détail : image du service ou de la réalisation, sinon photo de la vitrine. Sans image : `public/og/brandself-partage.jpg` (statique). Variante créée à la première demande puis conservée, servie `immutable`. `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:card=summary_large_image`. |
| 148 | Open Graph | `og:type` : `profile` sur l'accueil de la vitrine (`profile:first_name`, `profile:last_name`), `website` ailleurs. `og:locale` = `fr_{pays}` si le pays est dans `OG_LOCALES_PAYS`, sinon `fr_FR`. `og:site_name` = `nomAffiche` sur une vitrine, `Brandself` ailleurs. `og:url` = canonique. |
| 149 | Indexation | `NOINDEX_ROUTES` (configuration, appliquée par `routeRules.robots`, donc meta et `X-Robots-Tag`) : `/studio/**`, `/onboarding`, `/connexion/**`, `/desabonnement` (déjà), `/*/reserver/**`, `/*/agenda`, `/*/contact`, `/@*`. Valeur `noindex, follow` pour agenda, contact et link-in-bio (les liens sont suivis) ; `noindex, nofollow` pour les autres. Pages d'erreur : `noindex` (déjà dans `error.vue`). |
| 150 | Sitemap | Index `/sitemap_index.xml` = carte `pages` (`/`, `/tarifs`) + carte `vitrines` **paginée** par `SITEMAP_URLS_PAR_CARTE = 5000` (H3). Source : `GET /api/__sitemap__/vitrines`. Par vitrine **publiée** : `/:u` ; `/:u/services` si au moins 1 service visible ; chaque service visible (`actif` et non masqué par le plan) ; `/:u/realisations` si au moins 1 ; chaque réalisation visible. **Exclus** : link-in-bio, agenda, contact, réserver, vitrines non publiées. `lastmod` = `max(updated_at)` de la vitrine et de l'élément. Cache du module `SITEMAP_CACHE_S = 600`. Pas de `priority` ni de `changefreq` (ignorés par Google). |
| 151 | Masquage S10 dans le sitemap | Lot B ajoute à `plan-visibilite.ts` (module unique) une variante par lot, `sqlVisiblesParLot`, avec `row_number() OVER (PARTITION BY vitrine_id ORDER BY created_at, id)` et la limite par vitrine passée en `VALUES`. Le plan est résolu par `resoudrePlanEffectif` pour chaque propriétaire du lot (une requête sur `abonnements` par lot). Une URL masquée peut rester au plus 10 min dans le sitemap : elle renvoie alors 404, ce qui est acceptable. |
| 152 | robots.txt | Configuration, et suppression de `public/_robots.txt`. `User-agent: *` : `Disallow: /studio`, `/onboarding`, `/connexion`, `/desabonnement`, `/api/` ; `Allow: /`. **Pas** de `Disallow` sur `/*/agenda` ni `/*/contact` : le robot doit lire leur `noindex`. Robots d'entraînement (`ROBOTS_IA_ENTRAINEMENT` : GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended, meta-externalagent, Bytespider, cohere-training-data-crawler) : `Disallow: /` si `ROBOTS_IA_POLITIQUE = 'recherche_seulement'` (défaut) ; `'tout_autoriser'` ou `'tout_bloquer'` possibles. Robots de recherche et de réponse (`ROBOTS_IA_RECHERCHE` : OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, DuckAssistBot, MistralAI-User) autorisés sauf `'tout_bloquer'`. `Sitemap: {site}/sitemap_index.xml`. `Content-Signal: search=yes, ai-input=yes, ai-train=no` par `aiReady.contentSignal`, cohérent avec la politique. |
| 153 | llms.txt | `nuxt-ai-ready` configuré : `llmsTxt: { pages: false, sections: LLMS_SECTIONS, notes: LLMS_NOTES }` (sans lecture des sitemaps à l'exécution, vérifié dans `llms-txt-utils.js`) ; `llmsFullTxt: false`, `contentNegotiation: false`, `botNegotiation: false`, `sitemapMd: false`, `agentSkills: false`, `mcpServerCard: false`, `apiCatalog: false`, `database: false`, `describedby: true`, `llmsTxtCacheSeconds: 3600`. Contenu : ce qu'est Brandself, la forme des adresses (`/{adresse}`, `/{adresse}/services/{service}`), la présence de JSON-LD Person et Service, liens `/`, `/tarifs`, sitemap, robots. Aucune vitrine listée. |
| 154 | Graphe schema.org d'une vitrine | `Person` (`@id = {canonique vitrine}#personne`) : `name`, `givenName`, `familyName`, `honorificPrefix` (Dr, Pr…), `jobTitle` = métier, `description` = accroche, `image` (photo absolue), `url`, `address { @type PostalAddress, addressLocality: ville, addressCountry: code ISO }`, `knowsAbout` = titres des services visibles (6 au plus), `sameAs` = liens visibles de type `reseau` (https seulement). `WebPage` (`about` = personne). Pas d'email ni de téléphone dans le JSON-LD (PII déjà visibles en HTML ; on ne les pousse pas aux agrégateurs). |
| 155 | Service, réalisation, fil d'Ariane | Détail d'un service : `Service` (`name`, `description`, `serviceType` = libellé du type, `provider` → `@id` de la personne, `areaServed` = `[City ville, Country pays]`, `offers { price (unités majeures), priceCurrency }` **seulement si payant** ; gratuit → `price: 0` ; devis → aucune offre). Détail d'une réalisation : `CreativeWork` (`creator` → `@id`, `dateCreated` si année, `image`, `locationCreated` si lieu). Listes et détails : `BreadcrumbList` (Accueil > Services > {titre}). Accueil `/` : `Organization` Brandself + `WebSite` (identité du module). |
| 156 | Avis et notes | **Aucun `Review` ni `AggregateRating`.** Les témoignages restent du HTML sémantique (`blockquote` + `cite`). Raison : avis choisis par le professionnel, sans note, non éligibles et trompeurs. |
| 157 | Validation du JSON-LD | Fonctions pures dans `app/utils/seo-schema.ts`, tests unitaires (champs requis présents, aucun `undefined` ni chaîne vide, URL absolues). E2E sur le build de production : extraction de chaque `script[type="application/ld+json"]`, `JSON.parse`, types attendus, `@id` résolus dans le graphe. Passage manuel du Rich Results Test et du Schema Markup Validator en préproduction, sortie collée dans le rapport (non bloquant en CI : outil en ligne). |
| 158 | Images | Pas de passage par IPX (`@nuxt/image`) : les variantes `sharp` existantes et le `srcset` du DTO suffisent. Image du Hero : `loading="eager"`, `fetchpriority="high"`, `sizes` exact, `width` et `height`. Toutes les autres : `loading="lazy"`, `decoding="async"`, `sizes`. Toute image a des dimensions réservées (`aspect-ratio`). |
| 159 | Polices | `@nuxt/fonts` : Fraunces limitée aux graisses réellement utilisées (à mesurer en lot A ; probablement 600 et 700), Figtree 400, 500 et 600, sous-ensemble `latin` seul, `font-display: swap`, police de repli métrique (fournie par le module, pas de décalage), préchargement de la graisse des titres seulement. |
| 160 | JavaScript des pages publiques | Hydratation paresseuse (Nuxt `hydrate-on-visible`) pour l'agenda, la réalisation à la une, le témoignage et les services hors écran. `nuxt-skew-protection` désactivé (H9). Aucun store global (déjà). Budget : JavaScript total transféré ≤ `BUDGET_JS_KO = 200` gzip sur l'accueil d'une vitrine (valeur mesurée en lot A ; si la mesure dépasse, le rapport propose un plan). |
| 161 | Budgets Lighthouse (mobile simulé, preset par défaut : 4G lente, CPU ×4) | LCP ≤ 2500 ms, CLS ≤ 0,1, TBT ≤ 300 ms, poids total ≤ `BUDGET_PAGE_KO = 900`. Scores SEO ≥ 0,95, accessibilité ≥ 0,95, bonnes pratiques ≥ 0,9 (bloquants) ; performance ≥ 0,85 (avertissement). Médiane de 3 passages. URL : `/`, `/dr-cabrel`, `/dr-cabrel/services/consultation-de-cardiologie` (slug du seed, à vérifier), `/@dr-cabrel`. Rendu serveur : TTFB p95 ≤ 400 ms sur le seed (mesuré par le script, sans cache). |
| 162 | Exécution de Lighthouse et du SEO en CI | Job `seo-perf` : seulement sur `workflow_dispatch` et sur les PR vers `main`, `needs: build` (artefact `.output`, H12), PostgreSQL et Redis en services, migrations + seed, `node .output/server/index.mjs`, puis `pnpm e2e:seo` (projet Playwright du build) puis `pnpm perf` (lhci, `chromePath` = Chromium de Playwright, aucun téléchargement). Jamais en parallèle d'une autre suite sur la même base. Durée cible ≤ 15 min hors build. En local : même enchaînement par `pnpm perf:local` après `pnpm build`. |
| 163 | Accessibilité | `@axe-core/playwright`, étiquettes `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. **0 violation `critical` ou `serious`** sur : `/`, `/tarifs`, `/connexion`, l'accueil de la vitrine, la liste et le détail des services, la liste et le détail des réalisations, `/@dr-cabrel`, agenda, contact. Un seul h1, `lang="fr"`, toute `<img>` a un `alt` (vide seulement si décorative), focus visible au clavier. Dette S10 (radios de durée du studio) : **hors périmètre** (studio). |
| 164 | 404 | Vitrine inconnue, non publiée, username réservé ou de format invalide, liste vide, élément masqué ou par le plan : statut HTTP **404** réel du document (la page d'erreur Nuxt rend 404), `noindex`, jamais en cache. Route inconnue sous une vitrine (`/dr-cabrel/inexistant`) : 404. |
| 165 | En-têtes | Médias (`/medias/**`) : `Cache-Control: public, max-age=31536000, immutable` (H7), `X-Content-Type-Options: nosniff`. `/_nuxt/**` : immutable (nginx). HTML public : `Cache-Control: no-cache` + `X-Accel-Expires` (#138). Toutes les réponses : `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (le désabonnement garde `no-referrer`). nginx : `gzip on` (text/html, css, js, json, svg, xml, text/plain), `http2 on`, `server_tokens off`. **CSP, HSTS preload, Permissions-Policy : S13.** |
| 166 | Site marketing `/` provisoire | Rendu serveur, palette Terracotta. Sections : h1 de promesse (PROJECT_CONTEXT §1) ; 3 fonctions (Être trouvé, Être compris, Être contacté ou réservé), icônes Phosphor ; tarifs réels de `GET /api/public/tarifs`, en réutilisant le composable et les composants de `/tarifs` (H : `useTarifs` et `components/tarifs/*` existent) ; boutons « Créer ma vitrine » → `/connexion` et « Voir un exemple » → `/dr-cabrel`. Pied : Tarifs, Connexion. Vocabulaire §2, aucun design inventé au-delà de sections empilées. Dans le cache (#139). JSON-LD `Organization` + `WebSite`. |

---

## 4. Architecture

### 4.1 Schéma de cache

```
Navigateur ──HTTPS/2──> nginx (microcache 10 s, liste blanche par X-Accel-Expires)
   │                       │  HIT / STALE (updating) ──> réponse immédiate
   │                       │  MISS / BYPASS (cookie de session, pas d'X-Accel-Expires)
   │                       v
   │                 Nitro (1 processus, H1)
   │                   plugin cache-public : route en liste blanche ET GET ET 200 ET sans Set-Cookie
   │                        → X-Accel-Expires: 10, Cache-Control: no-cache
   │                   sinon : aucun en-tête de cache, ou celui de la page (private, no-store)
   │                   rendu serveur → /api/public/* → services → PostgreSQL (masquage S10 calculé avec now)
   └── après hydratation : créneaux rafraîchis (GET /api/public/:u/creneaux, jamais en cache)
                            S11 : POST /api/public/:u/vue (jamais en cache)
Modification au studio → écriture en base → visible au plus tard 10 s après (+ temps de rendu)
Échéance d'abonnement (temps) → prise en compte au plus tard 10 s après la bascule (aucun tick)
```

### 4.2 Fichiers (\* = créé)

**Configuration et contrats (lot A)**
- `nuxt.config.ts`, configuration exacte à appliquer :
  - `site` (#137) ;
  - `seo: { redirectToCanonicalSiteUrl: false }` (la redirection est faite en #146) ;
  - `ogImage: { enabled: false }` (configuration de base, plus seulement en dev) ;
  - `skewProtection: { enabled: false }` (H9) ;
  - `robots: { groups: construits depuis server/config/seo.ts, sitemap: '/sitemap_index.xml', disallow: [...] }` ;
  - `sitemap: { sitemaps: { pages: { includeAppSources: false, urls: ['/', '/tarifs'] }, vitrines: { sources: ['/api/__sitemap__/vitrines'], chunks: SITEMAP_URLS_PAR_CARTE } }, cacheMaxAgeSeconds: SITEMAP_CACHE_S, autoLastmod: false }` ;
  - `schemaOrg: { identity: { type: 'Organization', name: 'Brandself', url, logo: '/og/brandself-logo.png' } }` ;
  - `aiReady: {...}` (#153) ;
  - `routeRules` : `robots` des routes de `NOINDEX_ROUTES` ;
  - `fonts` (#159).
  - Le bloc `$development` reste (sitemap, robots, aiReady coupés en dev).
  - Les constantes viennent de `shared/seo.ts`. Pas d'import de `server/config` dans `nuxt.config` s'il crée un cycle : sinon les listes de robots vont dans `shared/seo.ts`, qui ne contient aucun secret.
- `shared/seo.ts`\* (pur) : constantes §5.1, `construireTitreVitrine`, `construireDescriptionVitrine`, `construireTitreService`, `construireDescriptionService`, `construireTitreRealisation`, `tronquerDescription`, `ogLocale(pays)`, `estRouteCacheable(path)` (matcher de `CACHE_HTML_ROUTES`), `cheminCanonique(path)` (minuscules, sans barre finale, ou `null` s'il ne s'applique pas).
- `shared/dto/vitrine.ts`, `shared/dto/service*.ts`, `shared/dto/realisation*.ts` : ajouter `seo.image: ImagePartageDTO | null` et `modifieLe` (pour `lastmod` et `og:updated_time`).
- `shared/schemas/vitrine.ts` (H11) : `seoTitre` (30–70 | null), `seoDescription` (50–160 | null).
- `public/og/brandself-partage.jpg`\*, `public/og/brandself-logo.png`\* (fournis par l'utilisateur, sinon un aplat Terracotta avec « Brandself » en provisoire). Suppression de `public/_robots.txt`.

**Serveur (lot B)**
- `server/plugins/cache-public.ts`\* : hook `beforeResponse`. Si `estRouteCacheable(path)` et GET/HEAD et 200 et aucun `set-cookie` → `X-Accel-Expires: CACHE_HTML_TTL_S` et `Cache-Control: no-cache`. Si la route est hors liste et qu'aucun `Cache-Control` n'est posé → aucun ajout. `X-Content-Type-Options` et `Referrer-Policy` posés s'ils sont absents. Aucune logique métier.
- `server/middleware/canonique.ts`\* : 301 (#146), sur la logique pure `cheminCanonique`.
- `server/api/__sitemap__/vitrines.get.ts`\* (route fine) → `listerUrlsSitemap(now)` → `toSitemapUrls`.
- `server/services/seo-sitemap.ts`\* : lecture des vitrines publiées par lots de `SITEMAP_LOT_VITRINES = 500`, plan par propriétaire (`resoudrePlanEffectif`), puis éléments visibles par `sqlVisiblesParLot`. Retour : `{ loc, lastmod }[]`.
- `server/services/plan-visibilite.ts` : `sqlVisiblesParLot(table, limitesParVitrine)`. Le module reste unique.
- `server/resources/vitrine.ts`, `service.ts`, `realisation.ts` : `seo.titre` et `seo.description` par les fonctions de `shared/seo.ts`, `seo.image` (URL absolue de la variante `partage`), `modifieLe`.
- `server/routes/medias/[id]/[fichier].get.ts` + service médias : variante `partage` (1200×630 JPEG, créée à la première demande, verrou contre les doubles rendus, stockage unstorage), `Cache-Control` (#165). La variante est servie **seulement** pour un média référencé par une vitrine publiée (photo, image de service ou de réalisation visible) : pas de génération arbitraire par un tiers.

**Frontend public (lot C)**
- `app/composables/useSeoVitrine.ts`\* : `useSeoVitrine({ vitrine, page, titre, description, image, fil?, schema? })`. Il appelle `useSeoMeta` (title, description, og:\*, twitter:\*, `og:locale`), `useHead({ titleTemplate: '%s' })` et `useSchemaOrg(...)` sur les nœuds de `seo-schema.ts`, plus le fil d'Ariane. Les pages n'appellent plus `useSeoMeta` ni `useSchemaOrg` directement.
- `app/utils/seo-schema.ts`\* (pur, sans Vue) : `noeudPersonne`, `noeudService`, `noeudRealisation`, `noeudFil` (renvoient des objets typés, URL absolues depuis `siteUrl`).
- Pages : `app/pages/[username]/index.vue`, `services/index.vue`, `services/[slug].vue`, `realisations/index.vue`, `realisations/[slug].vue`, `app/pages/@[username].vue` (noindex,follow + og) ; `agenda.vue` et `contact.vue` (`noindex, follow`) ; `reserver.vue` et `reserver/confirmation.vue` (inchangés sauf canonique absente).
- `app/composables/usePublicAgenda.ts` : option `rafraichirAuMontage`.
- `app/components/vitrine/**` : Hero (priorité de l'image, `sizes`), images paresseuses, hydratation paresseuse, un seul h1 (H10), `alt`.
- `app/error.vue` : texte générique si la page n'est pas une vitrine (« Cette page est introuvable. »), statut inchangé.

**Frontend marketing et studio (lot D)**
- `app/pages/index.vue`, `app/components/marketing/{Promesse,Fonctions,TarifsResume}.vue`\*, `app/pages/tarifs.vue` (balises seulement).
- `app/pages/studio/profil.vue`, `app/components/studio/profil/SeoGoogle.vue`\* (champs + aperçu).

**Déploiement et CI (lot E)**
- `deploy/nginx/brandself-cache.conf`\* (niveau `http` : `proxy_cache_path /var/cache/nginx/brandself levels=1:2 keys_zone=brandself_html:10m max_size=256m inactive=10m use_temp_path=off;`, `map $http_cookie $bs_session { default 0; ~*session_token 1; }`).
- `deploy/nginx/brandself-location.conf` (lu en entier avant modification) : `location /` avec `proxy_cache`, la clé, `proxy_cache_bypass $bs_session`, `proxy_no_cache $bs_session`, `use_stale`, `lock`, `background_update`, `X-Cache-Status` ; `location /_nuxt/` immutable ; gzip ; `http2 on`.
- `deploy/verifier-cache.sh`\* : curl contre la préproduction pour CA « VPS ».
- `.github/workflows/ci.yml` : job `seo-perf`.
- `lighthouserc.cjs`\*, `playwright.seo.config.ts`\* (`webServer` = build de production).
- `package.json` : scripts `e2e:seo`, `perf`, `perf:local` ; devDependencies `@lhci/cli` et `@axe-core/playwright`.

---

## 5. Contrats `shared/`

### 5.1 `shared/seo.ts` (constantes nommées)

```ts
export const SEO_TITRE_MIN = 30, SEO_TITRE_MAX = 70
export const SEO_DESCRIPTION_MIN = 50, SEO_DESCRIPTION_MAX = 160
export const SITE_DESCRIPTION = 'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.'
export const SEPARATEUR_TITRE = ' — '
export const TITRE_TEMPLATE_BRANDSELF = '%s · Brandself'
export const CACHE_HTML_TTL_S = 10
export const CACHE_HTML_ROUTES = ['/', '/tarifs', '/:u', '/:u/services', '/:u/services/:slug',
  '/:u/realisations', '/:u/realisations/:slug', '/@:u'] as const
export const NOINDEX_ROUTES: Readonly<Record<string, 'noindex, follow' | 'noindex, nofollow'>> = {
  '/studio/**': 'noindex, nofollow', '/onboarding': 'noindex, nofollow', '/connexion/**': 'noindex, nofollow',
  '/desabonnement': 'noindex, nofollow', '/*/reserver/**': 'noindex, nofollow',
  '/*/agenda': 'noindex, follow', '/*/contact': 'noindex, follow' }   // '/@*' : posé par la page
export const ROBOTS_DISALLOW = ['/studio', '/onboarding', '/connexion', '/desabonnement', '/api/'] as const
export const ROBOTS_IA_POLITIQUES = ['recherche_seulement', 'tout_autoriser', 'tout_bloquer'] as const
export const ROBOTS_IA_POLITIQUE: (typeof ROBOTS_IA_POLITIQUES)[number] = 'recherche_seulement'
export const ROBOTS_IA_ENTRAINEMENT = ['GPTBot','ClaudeBot','CCBot','Google-Extended','Applebot-Extended',
  'meta-externalagent','Bytespider','cohere-training-data-crawler'] as const
export const ROBOTS_IA_RECHERCHE = ['OAI-SearchBot','ChatGPT-User','PerplexityBot','Perplexity-User',
  'Claude-SearchBot','Claude-User','DuckAssistBot','MistralAI-User'] as const
export const SITEMAP_URLS_PAR_CARTE = 5000, SITEMAP_CACHE_S = 600, SITEMAP_LOT_VITRINES = 500
export const OG_IMAGE_LARGEUR = 1200, OG_IMAGE_HAUTEUR = 630, OG_IMAGE_QUALITE = 82
export const OG_IMAGE_DEFAUT = '/og/brandself-partage.jpg'
export const OG_LOCALES_PAYS = ['CM','FR','SN','CI','BE','CH','CA','GA','CG','CD','BJ','TG','BF','ML','NE','TD','RW','MG'] as const
export const SCHEMA_KNOWS_ABOUT_MAX = 6
export const BUDGETS = { lcpMs: 2500, cls: 0.1, tbtMs: 300, jsKo: 200, pageKo: 900, ttfbP95Ms: 400,
  scoreSeo: 0.95, scoreA11y: 0.95, scoreBonnesPratiques: 0.9, scorePerf: 0.85 } as const
export const LLMS_SECTIONS = [/* À propos, Adresses publiques, LLM Resources */] as const
```

### 5.2 DTO

```ts
export interface ImagePartageDTO { url: string, largeur: 1200, hauteur: 630, alt: string }  // url absolue
// VitrinePubliqueDTO.seo : { titre, description, image: ImagePartageDTO | null }, + modifieLe: string
// ServicePublicDTO.seo et RealisationPubliqueDTO.seo : idem (image de l'élément, sinon celle de la vitrine, sinon null)
// L'application remplace null par OG_IMAGE_DEFAUT.
export interface SitemapUrlDTO { loc: string, lastmod: string }   // chemin relatif, ISO 8601
```

Aucun nouveau code d'erreur. Aucune migration (la 0022 reste réservée à S11).

---

## 6. Critères d'acceptation

Étiquettes :
- **[U]** : test unitaire pur ;
- **[PG]** : intégration contre le vrai PostgreSQL (aucun mock du repository ni du SQL) ;
- **[E2E-dev]** : Playwright sur `nuxt dev` ;
- **[E2E-prod]** : Playwright sur le build de production (`playwright.seo.config.ts`) ;
- **[LH]** : Lighthouse CI ;
- **[VPS]** : script `deploy/verifier-cache.sh` contre la préproduction, sortie collée.

L'horloge est injectée pour [U] et [PG].

### Titres, descriptions, Open Graph
- **CA01 [U]** `construireTitreVitrine({ nomAffiche: 'Dr Cabrel Nguesso', metier: 'Cardiologue interventionnel', ville: 'Douala' })` = `Dr Cabrel Nguesso — Cardiologue interventionnel à Douala` ; avec `seoTitre: 'Cardiologue à Douala, Dr Nguesso'` → la valeur saisie.
- **CA02 [U]** `construireDescriptionVitrine` : sans `seoDescription`, le résultat commence par `Cardiologue interventionnel à Douala (Cameroun).` et contient l'accroche. Une accroche de 300 caractères est tronquée à ≤ 160, sur une fin de mot, avec « … ». Sans accroche, la bio est utilisée. Sans bio, le gabarit `Dr Cabrel Nguesso, cardiologue…` est utilisé. Jamais de chaîne vide.
- **CA03 [U]** `construireTitreService('Consultation de cardiologie', vitrine)` = `Consultation de cardiologie — Dr Cabrel Nguesso — Douala`.
- **CA04 [U]** `ogLocale('CM')` = `fr_CM` ; `ogLocale('US')` = `fr_FR` ; `ogLocale(null)` = `fr_FR`.
- **CA05 [PG]** `GET /api/public/dr-cabrel` → `vitrine.seo.titre` (CA01), `seo.description` (CA02), `seo.image.url` absolue se terminant par la variante `partage`, `largeur: 1200`, `hauteur: 630`, `modifieLe` ISO.
- **CA06 [E2E-prod]** Pour chaque page, avec `/dr-cabrel` : accueil, `/services`, détail d'un service, `/realisations`, détail d'une réalisation, `/@dr-cabrel`. Le HTML **du serveur** (requête sans JavaScript) contient :
  - un `<title>` conforme à #143, **sans** « Brandself » ;
  - `meta[name=description]` de 50 à 160 caractères ;
  - `link[rel=canonical]` absolu, sans query ni barre finale, égal à `og:url` ;
  - `og:title`, `og:description`, `og:image` (absolue, et `GET` de cette URL → 200 `image/jpeg` 1200×630), `og:image:alt`, `og:locale=fr_CM`, `og:type` (`profile` à l'accueil) ;
  - `twitter:card=summary_large_image` ;
  - `<html lang="fr">` ;
  - **exactement un h1**.
- **CA07 [E2E-prod]** `/` et `/tarifs` : titres `Brandself — votre vitrine en ligne` et `Tarifs · Brandself`, canonique, `og:image` = image par défaut.
- **CA08 [E2E-dev]** Profil : saisir « Description sur Google » de 40 caractères → message de validation (minimum 50), enregistrement impossible ; 120 caractères → enregistré, l'aperçu l'affiche. « Revenir à la version automatique » → champ vide, et `GET /api/public/dr-cabrel` rend la description automatique.
- **CA09 [PG]** `PUT` Profil avec `seoDescription: ''` → stocké `NULL` ; 161 caractères → 422 `VALIDATION`.

### Données structurées
- **CA10 [U]** `noeudPersonne(vitrine, services, liens, siteUrl)` :
  - `@type: 'Person'`, `@id` = `https://…/dr-cabrel#personne`, `honorificPrefix: 'Dr'`, `jobTitle` = métier, `address.addressLocality: 'Douala'`, `address.addressCountry: 'CM'` ;
  - `knowsAbout` ≤ 6 titres ;
  - `sameAs` ne contient que les liens `reseau` en https ;
  - ni `email` ni `telephone` ;
  - aucune valeur `undefined`, `null` ou `''` (parcours récursif).
- **CA11 [U]** `noeudService` : payant 25 000 XAF → `offers.price = 25000`, `priceCurrency: 'XAF'` ; EUR 4 500 centimes → `45` ; gratuit → `price: 0` ; devis → aucune clé `offers`. `provider['@id']` = l'`@id` de la personne. `areaServed` contient `City` Douala et `Country` CM.
- **CA12 [U]** Aucun nœud ne produit `Review`, `AggregateRating` ni `ProfessionalService` : un test statique parcourt `app/utils/seo-schema.ts` et `app/pages/[username]/**`.
- **CA13 [E2E-prod]** Pour chaque page de CA06 : chaque `script[type="application/ld+json"]` se parse. Le graphe contient : `Person` (accueil, liste, détail), `Service` (détail d'un service), `CreativeWork` (détail d'une réalisation), `BreadcrumbList` à 3 éléments sur les détails et à 2 sur les listes, `WebPage`. Tout `@id` référencé existe dans le graphe. `/` contient `Organization` et `WebSite`.
- **CA14 (manuel, préproduction)** Le Rich Results Test et validator.schema.org sur l'accueil et le détail d'un service : 0 erreur. Sortie collée dans le rapport.

### Indexation, robots, llms.txt
- **CA15 [E2E-prod]** `/dr-cabrel/agenda`, `/dr-cabrel/contact`, `/@dr-cabrel` : `meta[name=robots]` contient `noindex` et `follow`, et l'en-tête `X-Robots-Tag` contient `noindex`. `/connexion`, `/dr-cabrel/reserver?service=…&debut=…` et `/desabonnement` : `noindex`. `/dr-cabrel`, ses services et ses réalisations : aucune directive `noindex`.
- **CA16 [E2E-prod]** `GET /robots.txt` → 200 `text/plain`, contient `Disallow: /studio`, `/onboarding`, `/connexion`, `/desabonnement`, `/api/`. **Ne contient pas** `Disallow: /*/agenda`. Contient `Sitemap: {site}/sitemap_index.xml`, un groupe `User-agent: GPTBot` (et chacun de `ROBOTS_IA_ENTRAINEMENT`) avec `Disallow: /`, et aucun `Disallow: /` pour `OAI-SearchBot`. Contient `Content-Signal` avec `ai-train=no`.
- **CA17 [U]** Constructeur des groupes robots : `tout_autoriser` → aucun groupe d'IA avec `Disallow: /` ; `tout_bloquer` → les deux listes en `Disallow: /` ; `recherche_seulement` → entraînement seulement.
- **CA18 [E2E-prod]** `GET /llms.txt` → 200 `text/plain`. Commence par `# Brandself`, contient `SITE_DESCRIPTION`, les liens `/tarifs` et sitemap. **Ne contient aucune URL de vitrine**, même avec 3 vitrines publiées dans le seed. `GET /llms-full.txt`, `/sitemap.md` et `/dr-cabrel.md` → 404.
- **CA19 [E2E-prod]** `GET /dr-cabrel` avec `Accept: text/markdown` ou `User-Agent: GPTBot` → HTML (pas de négociation Markdown), réponse identique à celle d'un navigateur.

### Sitemap
- **CA20 [PG]** Seed : `dr-cabrel` (gratuit, publiée, 6 services dont 3 visibles par le plan, 3 réalisations), `dr-cabrel-payant` (5 services visibles), `dr-cabrel-grace`, plus une vitrine **non publiée** `brouillon-x`. `listerUrlsSitemap(now)` contient :
  - `/dr-cabrel`, `/dr-cabrel/services`, exactement les 3 services visibles, `/dr-cabrel/realisations` et les 3 réalisations ;
  - les 5 services de `dr-cabrel-payant` ;
  - aucune URL de `brouillon-x` ;
  - aucune URL `/@…`, `/agenda`, `/contact`, `/reserver`.
- **CA21 [PG]** Un service `actif = false` → absent. Une vitrine sans réalisation visible → pas de `/realisations`.
- **CA22 [PG]** Expiration : `dr-cabrel-grace` avec `now` = fin de grâce − 1 s → 5 services ; `now` = fin de grâce + 1 s → les 3 plus anciens seulement (**sans aucune écriture en base entre les deux appels**).
- **CA23 [PG]** `lastmod` d'un service = `max(service.updated_at, vitrine.updated_at)` au format ISO. Modifier le service avance son `lastmod`.
- **CA24 [PG]** Performance : 2 000 vitrines générées (50 000 URL) → `listerUrlsSitemap` en ≤ 2 s et un nombre de requêtes SQL ≤ 3 par lot de 500 (espion sur l'exécuteur, mais SQL réel).
- **CA25 [E2E-prod]** `GET /sitemap_index.xml` → 200 XML valide référençant `pages` et au moins une carte `vitrines`. La carte `vitrines` contient `https://…/dr-cabrel` et pas `/studio`.

### Canonique et 404
- **CA26 [U]** `cheminCanonique('/Dr-Cabrel/Services/')` = `/dr-cabrel/services` ; `('/@Dr-Cabrel')` = `/@dr-cabrel` ; `('/dr-cabrel')` = `null` (déjà canonique) ; `('/api/Public/X')`, `('/_nuxt/A.js')`, `('/medias/ab/F.webp')`, `('/Studio')` = `null`.
- **CA27 [E2E-prod]** `GET /Dr-Cabrel?utm_source=wa` → **301** `Location: /dr-cabrel?utm_source=wa`. `GET /dr-cabrel/` → 301 `/dr-cabrel`. `POST /Dr-Cabrel` → pas de redirection.
- **CA28 [E2E-prod]** Statut HTTP du document : `/inconnu-xyz` → 404 ; `brouillon-x` (non publiée) → 404 ; `/api` (réservé) → pas une page de vitrine ; `/dr-cabrel/inexistant` → 404 ; `/dr-cabrel/services/slug-inexistant` → 404 ; le 4e service de `dr-cabrel` (masqué par le plan) → 404. Une vitrine sans réalisation → `/x/realisations` en 404. Chacune a `meta robots noindex`, et **aucune n'a `X-Accel-Expires`**.

### Cache et état utilisateur
- **CA29 [U]** `estRouteCacheable` : vrai pour les 8 motifs de #139 ; faux pour `/studio`, `/studio/services`, `/onboarding`, `/connexion`, `/connexion/code`, `/desabonnement`, `/dr-cabrel/reserver`, `/dr-cabrel/reserver/confirmation`, `/dr-cabrel/agenda`, `/dr-cabrel/contact`, `/api/public/dr-cabrel`, `/medias/x/y`.
- **CA30 [E2E-prod]** `GET /dr-cabrel` sans cookie → `X-Accel-Expires: 10` et `Cache-Control: no-cache`. `/dr-cabrel/reserver/confirmation` → `Cache-Control: private, no-store` et **pas** d'`X-Accel-Expires`. `/desabonnement?jeton=…` → `no-store`, pas d'`X-Accel-Expires`. `/connexion` → pas d'`X-Accel-Expires`.
- **CA31 [E2E-prod]** `GET /dr-cabrel` **avec** un cookie de session valide : si la réponse porte un `Set-Cookie`, alors pas d'`X-Accel-Expires` (le plugin le vérifie).
- **CA32 [VPS]** Deux `GET /dr-cabrel` sans cookie à 1 s d'écart → `X-Cache-Status: MISS` puis `HIT`. Avec un cookie `…session_token=…` → `BYPASS`. `/dr-cabrel/reserver/confirmation` → jamais `HIT`. `GET /dr-cabrel?x=MARQUEUR` puis `GET /dr-cabrel` → le second ne contient pas `MARQUEUR`.
- **CA33 [VPS]** Modification au studio : renommer le métier de la vitrine de démonstration à T0, puis interroger `/dr-cabrel` toutes les secondes → le nouveau métier apparaît au plus tard à T0 + 12 s (TTL + rendu). Masquer un service → son détail renvoie 404 au plus tard à T0 + 12 s (404 jamais mis en cache).
- **CA34 [PG]** Expiration par le temps, sans cache : `GET /api/public/dr-cabrel-grace/services` avec l'horloge injectée juste avant puis juste après la fin de grâce → 5 puis 3 services (prouve que la seule borne de staleness est le TTL nginx).
- **CA35 [E2E-dev]** Accueil de `dr-cabrel` : après l'hydratation, une requête `GET /api/public/dr-cabrel/creneaux` part sans action de l'utilisateur (`rafraichirAuMontage`). Le bloc agenda ne change pas de hauteur (CLS de la zone ≤ 0,01, mesuré par `PerformanceObserver`).

### Médias et image de partage
- **CA36 [PG]** `GET` variante `partage` de la photo de `dr-cabrel` → 200 `image/jpeg`, 1200×630 (lu par `sharp`), sans EXIF, `Cache-Control: public, max-age=31536000, immutable`. Deux demandes simultanées → un seul fichier créé.
- **CA37 [PG]** Variante `partage` d'un média qui n'appartient à aucune vitrine publiée, ou d'un service masqué → 404, rien n'est généré.
- **CA38 [U]** Choix de l'image : détail d'un service avec image → image du service ; sans image → photo de la vitrine ; vitrine sans photo → `OG_IMAGE_DEFAUT`.

### Marketing `/`
- **CA39 [E2E-dev]** `/` à 390, 768 et 1280 px :
  - h1 unique de promesse ;
  - 3 fonctions ;
  - prix lus dans `GET /api/public/tarifs` (aucun prix littéral dans `app/components/marketing/**` : test statique, comme le CA97 de S10) ;
  - « Créer ma vitrine » → `/connexion`, « Voir un exemple » → `/dr-cabrel` ;
  - aucun mot interdit (« espace », « bloc », « module », « widget », « section ») dans le texte visible ;
  - aucune barre de défilement horizontale.

### Performance et accessibilité
- **CA40 [LH]** Pour les 4 URL de #161, en mobile simulé, médiane de 3 passages : LCP ≤ 2 500 ms, CLS ≤ 0,1, TBT ≤ 300 ms, scores SEO ≥ 0,95, accessibilité ≥ 0,95, bonnes pratiques ≥ 0,9. Poids total ≤ 900 Ko, JavaScript ≤ 200 Ko. Rapport collé (sortie brute `lhci autorun`).
- **CA41 [E2E-prod]** Accueil : l'image du Hero porte `fetchpriority="high"` et pas `loading="lazy"`. Toutes les autres `<img>` portent `loading="lazy"`, et chaque `<img>` a `width`, `height` et `alt`.
- **CA42 [E2E-prod]** Le HTML de l'accueil précharge au plus 2 fichiers de police, tous en `woff2`, sous-ensemble latin.
- **CA43 [E2E-prod]** axe (#163) sur les 11 pages : 0 violation `critical` ou `serious`. Liste des `moderate` jointe au rapport.
- **CA44 [E2E-prod]** Clavier : depuis le haut de l'accueil, `Tab` atteint « Réserver » en ≤ 6 appuis, et chaque élément focalisé a un contour visible (style calculé `outline-width ≥ 2px` ou `box-shadow`).

### Réception SPRINTS
- « Données structurées valides » = CA10 à CA14.
- « Sitemap correct » = CA20 à CA25.
- « Modification visible en quelques secondes » = CA33 (+ CA30 et CA32). C'est l'écart assumé #138 : borne de 10 s, sans purge.
- « Budgets dans le rapport Lighthouse » = CA40.
- « Aucun problème critique d'accessibilité » = CA43.
- « e2e balises de chaque page » = CA06, CA07, CA13, CA15.

---

## 7. Découpage en lots (périmètres de fichiers disjoints)

| Lot | Agent | Fichiers (exclusifs) | Prérequis | Taille |
|---|---|---|---|---|
| **A**, hypothèses, configuration, contrats | backend (thread principal possible) | `nuxt.config.ts`, `shared/seo.ts`\*, `shared/dto/{vitrine,service*,realisation*}.ts` (+ `shared/dto/index.ts`), `shared/schemas/vitrine.ts`, `public/_robots.txt` (supprimé), `public/og/*`\*. **Rapport H1 à H13** + mesure de base (poids JS, graisses de police utilisées) | — | M |
| **F1**, tests RED | tester | `tests/unit/seo-*.test.ts`\*, `tests/unit/seo-schema.test.ts`\*, `tests/integration/seo-sitemap.test.ts`\*, `tests/integration/cache-public.test.ts`\*, `tests/integration/canonique.test.ts`\*, `tests/integration/medias-partage.test.ts`\*, fabriques de `tests/support/**` | A | M |
| **B**, serveur | backend | `server/plugins/cache-public.ts`\*, `server/middleware/canonique.ts`\*, `server/api/__sitemap__/vitrines.get.ts`\*, `server/services/seo-sitemap.ts`\*, `server/services/plan-visibilite.ts`, `server/resources/{vitrine,service,realisation}.ts`, `server/routes/medias/[id]/[fichier].get.ts`, service médias (variante `partage`) | A, F1 | M |
| **C**, pages publiques | frontend | `app/composables/useSeoVitrine.ts`\*, `app/utils/seo-schema.ts`\*, `app/pages/[username]/**`, `app/pages/@[username].vue`, `app/components/vitrine/**`, `app/composables/usePublicAgenda.ts`, `app/error.vue` | A (contrat DTO) ; parallèle à B et F1 | M |
| **D**, marketing et Profil | frontend | `app/pages/index.vue`, `app/components/marketing/**`\*, `app/pages/tarifs.vue`, `app/pages/studio/profil.vue`, `app/components/studio/profil/SeoGoogle.vue`\* | A ; parallèle à C (lit `useTarifs` sans le modifier) | S |
| **E**, nginx et CI | devops | `deploy/nginx/brandself-location.conf`, `deploy/nginx/brandself-cache.conf`\*, `deploy/verifier-cache.sh`\*, `.github/workflows/ci.yml`, `lighthouserc.cjs`\*, `playwright.seo.config.ts`\*, `package.json` (scripts et devDependencies), `pnpm-lock.yaml` | A ; parallèle à B, C, D | M |
| **F2**, e2e et mesures | e2e-tester | `e2e/seo/**`\*, `e2e/a11y/**`\*, `e2e/helpers/seo.ts`\*, données de CA20 dans `server/db/seed.ts` (vitrine non publiée `brouillon-x` seulement) | B, C, D, E. **Seule suite sur la base partagée à ce moment-là** | M |
| **G** | reviewer (CRITICAL et MAJOR), regression-checker (tout le dépôt : consommateurs des DTO, e2e S2 à S10 qui lisent les titres et `useSeoMeta`, `Pied` et badge, agenda), ux-reviewer (`/`, Profil « Sur Google », agenda rafraîchi) | lecture seule | F2 | M |
| **H** | thread principal | `PROJECT_STATE.md`, `docs/JOURNAL_DECISIONS.md` (#135 à #166), `CLAUDE.md` §8 (`@lhci/cli`, `@axe-core/playwright`), `.env.example` (`NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_SITE_ENV`), `docs/specs/S12-seo-performance.md` | G | S |

\* = fichier créé.

**Ordre** : A → (F1 ∥ C ∥ D ∥ E) → B → build de production → F2 (e2e-prod + axe) → Lighthouse (CA40) → G → H. Au plus 3 cycles RED → GREEN pour B ; au-delà, retour à l'architecte.

**Consommateurs à vérifier en G** :
- `VitrinePubliqueDTO.seo` (la forme change : ajout de `image`) ;
- les tests `resource-service` et `resource-realisation` ;
- les e2e S3 et S4 qui lisent `<title>` ;
- `usePublicAgenda` (accueil, détail d'un service, `/reserver`, `/agenda`) ;
- les routes qui posent déjà `Cache-Control` (confirmation, désabonnement) ;
- `server/plugins/error-handler.ts` (aucune interaction avec `beforeResponse`).

---

## 8. Risques et mitigations

| Risque | Mitigation |
|---|---|
| Une page avec un état utilisateur ou un jeton est mise en cache | Liste blanche + aucun `Set-Cookie` + contournement par cookie nginx + `private, no-store` respecté (CA29 à CA32). Rien n'est en cache par défaut |
| Contenu masqué (plan, dépublication) servi depuis le cache | TTL de 10 s ; 404 jamais en cache ; repli en erreur borné par `inactive=10m` (accepté et documenté) |
| Empoisonnement du cache par la query | Clé sans query, pages en cache qui ne lisent pas la query, CA32 avec marqueur |
| Fuite de pages privées dans le sitemap | Source unique en SQL (vitrines publiées, éléments `actif`, masquage par `plan-visibilite`), CA20 à CA22 |
| Sitemap coûteux avec beaucoup de vitrines | Lots de 500, ≤ 3 requêtes par lot, cache du module 10 min, CA24 |
| `nuxt-ai-ready` actif par défaut en production (négociation Markdown, lecture des sitemaps, skills) | Configuration explicite #153, CA18 et CA19 |
| Image de partage lourde, polices téléchargées au build | `nuxt-og-image` désactivé ; variante `sharp` créée une seule fois, servie immutable ; génération réservée aux médias publics (CA37) |
| Données structurées trompeuses | Pas d'avis ni de note, pas de `ProfessionalService`, PII absentes du JSON-LD, CA12 |
| Mémoire 7 Go, builds de 10 à 19 min | Une seule suite à la fois ; job `seo-perf` qui réutilise l'artefact du build ; Lighthouse lancé après les e2e, jamais en même temps ; Chromium de Playwright réutilisé |
| Mesures Lighthouse instables en CI | Médiane de 3 ; scores de performance en avertissement ; métriques (LCP, CLS) bloquantes avec la marge du preset |
| Tests SEO lancés en dev (modules coupés) qui donnent une fausse confiance | Projet Playwright dédié au build ; ne jamais présenter un CA [E2E-prod] lancé en dev comme vert |
| Microcache impossible à tester sans nginx en local | Le comportement de Nitro (en-têtes) est testé en e2e ; nginx est vérifié par `nginx -t` + `verifier-cache.sh` en préproduction (CA32 et CA33, sortie collée). Tant que ce n'est pas fait : « non exécuté », jamais « vert » |
| Redirection 301 qui casse des routes internes | Exclusions explicites + CA26 + régression (G) |
| Nom du cookie de session différent (H13) | Motif `session_token` dans la `map` ; CA32 |
| Format interne des clés du cache Nitro (si l'on revenait à `routeRules.swr`) | Non utilisé (#138) |

---

## 9. Paramètres à rendre configurables depuis le futur panel admin

- **Cache** : TTL HTML (10 s), routes en cache, routes `noindex` et leur directive.
- **Robots** : politique IA (`recherche_seulement`, `tout_autoriser`, `tout_bloquer`), listes des robots d'entraînement et de recherche, chemins interdits, `Content-Signal`.
- **llms.txt** : sections, notes, durée de cache.
- **Sitemap** : URL par carte (5000), lot de vitrines (500), durée de cache (600 s), pages Brandself listées.
- **SEO** : bornes de titre (30–70) et de description (50–160), gabarits de titre et de description, séparateur, `titleTemplate` Brandself, description du site.
- **Image de partage** : dimensions, qualité, image par défaut, logo.
- **Données structurées** : `knowsAbout` maximum, types de liens publiés en `sameAs`.
- **Locales** : pays → `og:locale`.
- **Budgets** : LCP, CLS, TBT, JavaScript, poids, TTFB, scores ; URL mesurées ; nombre de passages.

Aujourd'hui : constantes nommées dans `shared/seo.ts`, modifiables seulement par déploiement.

---

## 10. Hors périmètre (idées)

- Redirection des anciens usernames (table d'historique, migration 0023)
- Génération IA de la description (nouveau type de prompt)
- Image de partage avec texte incrusté (`nuxt-og-image` + polices locales)
- `llms.txt` ou Markdown par vitrine
- Cache applicatif Redis des lectures publiques, avec invalidation par version
- Purge nginx
- hreflang et version bilingue
- Google Business Profile (accompagnement des professionnels)
- Indexation de la page Contact
- CSP, HSTS preload, Permissions-Policy (S13)
- Brotli
- CDN
- Dette S10 : médias d'un élément masqué toujours servis
- Dette S10 : accessibilité des radios de durée du studio
- Envoi de « vue » (S11)

---

## 11. Questions ouvertes (avec proposition)

1. **Cache** : la borne de 10 s sans invalidation exacte vous convient-elle (#138) ? Proposition : oui. Rouvrir un cache Redis versionné seulement si le test de charge de S13 le justifie.
2. **Robots d'IA** : faut-il interdire l'entraînement par défaut (`recherche_seulement`) ? Proposition : oui (contenu des professionnels protégé, visibilité dans les réponses IA gardée). Alternative : `tout_autoriser`, plus de présence dans les modèles.
3. **Anciennes adresses après un changement d'username** : 404 aujourd'hui. Proposition : table `anciennes_adresses` + 301 pendant 12 mois, en S13 (migration 0023).
4. **Description par l'IA** : proposition, repli déterministe en S12, et bouton IA « Proposer une description » plus tard, sur le modèle d'« Améliorer avec l'IA ».
5. **Link-in-bio** indexé ou non ? Proposition : `noindex, follow` (contenu mince, doublon de l'accueil).
6. **Contact** indexé ? Proposition : non (l'accueil porte déjà le contact).
7. **Image de partage** : photo seule (#147), ou carte avec nom et métier (`nuxt-og-image`, plus coûteux) ? Proposition : photo seule en v1.
8. **Budgets** : JavaScript ≤ 200 Ko gzip à confirmer après la mesure de base du lot A.
9. **`@nuxt/image`** : le retirer s'il n'est pas utilisé (H8) ? Proposition : oui, une dépendance et un temps de build en moins.
10. **CI** : `seo-perf` seulement sur les PR vers `main` et en manuel ? Proposition : oui.
11. **Préproduction** : `NUXT_PUBLIC_SITE_ENV` pour forcer le `noindex` hors production. Nom à confirmer (ou réutiliser une variable existante).

---

## 12. Prérequis côté utilisateur

1. **Nom de domaine** `brandself.io` : DNS vers le VPS, certificat HTTPS, `NUXT_PUBLIC_SITE_URL=https://brandself.io` en production. La préproduction doit être sur un autre hôte et en `noindex`.
2. **Google Search Console** : propriété « domaine » (enregistrement DNS TXT), envoi de `https://brandself.io/sitemap_index.xml`, suivi de la couverture.
3. **Bing Webmaster Tools** : import depuis Search Console, envoi du sitemap. Bing alimente aussi Copilot et une partie de la recherche ChatGPT : c'est un levier GEO direct. Activer IndexNow plus tard (hors périmètre).
4. **Images de marque** : `brandself-partage.jpg` (1200×630) et logo carré (au moins 512 px) pour le JSON-LD `Organization`.
5. **Persona de démonstration** : une vraie photo de Dr Cabrel Nguesso pour la mesure du LCP (sinon la mesure se fait sur une image de démonstration, et il faut le dire).
6. **VPS** : version de nginx (H2), dossier `/var/cache/nginx/brandself` accessible en écriture, accord pour `nginx -t` + reload, nombre de processus PM2 (H1).
7. **Décisions** : Q1, Q2, Q5 et Q7 avant la mise en production.

---

## Fichiers clés

- /home/cabrel/projects/brandself-app/brandself-app/nuxt.config.ts (sous-modules SEO coupés en dev seulement ; ogImage, aiReady et skew actifs en production)
- /home/cabrel/projects/brandself-app/brandself-app/node_modules/.pnpm/@nuxtjs+seo@6.0.1_6d8d43ef083d21d931e9f0cd254ef239/node_modules/@nuxtjs/seo/dist/module.mjs (sous-modules et versions minimales)
- /home/cabrel/projects/brandself-app/brandself-app/node_modules/.pnpm/nuxt-ai-ready@3.4.0_d430d5b0851470b01c85c00d21a2ac32/node_modules/nuxt-ai-ready/dist/runtime/types.d.ts (options de llms.txt, négociation, contentSignal)
- /home/cabrel/projects/brandself-app/brandself-app/node_modules/.pnpm/nuxt-ai-ready@3.4.0_d430d5b0851470b01c85c00d21a2ac32/node_modules/nuxt-ai-ready/dist/runtime/llms-txt-utils.js (avec `pages: false`, aucune lecture des sitemaps)
- /home/cabrel/projects/brandself-app/brandself-app/server/resources/vitrine.ts (replis `seo` existants, lignes 91-94)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/vitrines.ts (`getPublicVitrine` normalise le username ; `changeUsername` sans historique)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/plan-visibilite.ts (module unique du masquage, à étendre par lot)
- /home/cabrel/projects/brandself-app/brandself-app/shared/db/schema.ts (`seo_titre` et `seo_description` présents, lignes 145-146)
- /home/cabrel/projects/brandself-app/brandself-app/app/pages/[username]/index.vue (agenda chargé pendant le rendu serveur : dépend du temps)
- /home/cabrel/projects/brandself-app/brandself-app/app/pages/[username]/reserver/confirmation.vue (`private, no-store` déjà en place)
- /home/cabrel/projects/brandself-app/brandself-app/public/_robots.txt (à supprimer)
- /home/cabrel/projects/brandself-app/brandself-app/deploy/nginx/brandself-location.conf (non lu : lot E)
- /home/cabrel/projects/brandself-app/brandself-app/.github/workflows/ci.yml (non lu : H12)