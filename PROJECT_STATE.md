# PROJECT_STATE.md — Brandself

Dernière mise à jour : **2026-10-25** · Phase : **S2 (Studio, Profil, accueil public) livré** · Prochaine action : **Sprint S3 (Services)**.

À mettre à jour à la fin de chaque sprint (statut, décisions prises, décisions ouvertes, dette connue).

## 1. Contexte de la refonte

L'ancien projet (Laravel + Nuxt, système de blocs polymorphique, ~60 tables, documents contradictoires) est abandonné au profit d'un **nouveau projet Nuxt fullstack** au périmètre réduit. La base technique de l'ancien projet n'est pas reprise en code ; certaines idées sont reprises (voir PROJECT_CONTEXT.md). Les anciens documents sont des archives (`docs/archive/`).

## 2. Avancement des sprints

| Sprint | Domaine | Statut | Jalon |
|---|---|---|---|
| S0 | Fondations | **fait** | base (btree_gist actif), worker BullMQ (file `systeme`, job `ping`), `/api/health`, Zod au démarrage, Vitest + Playwright + CI, lint/typecheck/build verts |
| S1 | Authentification (OTP, Google) | **fait** | connexions email/téléphone + code 6 chiffres, garde OTP Redis, pages `/connexion`, `/connexion/code`, `/studio`, onboarding, vitrines statiques `@username`/`[username]`, e2e 8/8 verts |
| S2 | Studio (coque), Profil, accueil public | **fait** | navigation 5 entrées (Vitrine/Services/Réalisations/Liens/Agenda), pages `/studio`, `/studio/profil`, `/studio/compte`, `/onboarding`, `/[username]` SSR, design system sur variables CSS (5 palettes), composants BsButton/BsField/BsSwitch/BsBadge/BsCard/BsTopNav/BsBottomNav, API studio (vitrine, medias, username-disponible, moi, publier/depublier), API publique `/api/public/[username]`, migrations vitrines/medias, upload sharp (WebP, EXIF, octets magiques) |
| S3 | Services | à faire | |
| S4 | Réalisations | à faire | |
| S5 | Témoignages | à faire | **Fin S5 : première version utilisable en interne** |
| S6 | Liens et link-in-bio | à faire | |
| S7 | Agenda, réservations, demandes | à faire | **Fin S7 : bêta fermée** (avec S8 pour l'inscription guidée) |
| S8 | Inscription guidée + IA | à faire | |
| S9 | Notifications et rétention | à faire | |
| S10 | Abonnements, plans, K-PAY | à faire | **Fin S10 : lancement payant** |
| S11 | Statistiques | à faire | |
| S12 | SEO final et performance | à faire | |
| S13 | Durcissement et lancement | à faire | |

## 3. Décisions ouvertes (valeurs par défaut en attendant)

| # | Sujet | Valeur par défaut retenue | À trancher avant |
|---|---|---|---|
| 1 | Prix du plan payant, par devise (XAF, EUR, USD) et remises 3 et 12 mois | marqueurs `[Prix]` en configuration | S10 |
| 2 | OTP par WhatsApp en v1 ou non | **email + SMS en v1** ; WhatsApp possible plus tard via `OtpSender` | S1 |
| 3 | Fournisseur d'envoi SMS (et WhatsApp si retenu) | à choisir ; en développement, le code s'affiche dans la console | S1 |
| 4 | Délai de grâce après expiration | 7 jours | S10 |
| 5 | Contenu en trop après expiration | masqué (les plus récents), jamais supprimé | S10 |
| 6 | Photo obligatoire à l'inscription | obligatoire | S8 |
| 7 | Essais de code OTP, durée, renvoi | 3 essais, 10 min, renvoi après 60 s | S1 |
| 8 | Statistiques : gratuit vs payant | gratuit 7 jours ; payant 90 jours avec pages et sources | S11 |
| 9 | Langue des identifiants de code | **appliqué en S0** : tables/champs d'API en français sans accents, code TypeScript en anglais | S0 ✅ |
| 10 | `@nuxt/ui` comme base de composants ou composants maison | **composants maison (BsButton, BsField, BsSwitch, BsBadge, BsCard, BsTopNav, BsBottomNav)** sur variables CSS des 5 palettes | S2 ✅ |
| 11 | Fournisseur et modèle d'IA | interchangeable ; à choisir | S8 |
| 12 | Hébergement, nom de domaine, serveur de courriels de production | VPS Ubuntu existant | S13 |
| 13 | Accès sandbox K-PAY (clés, documentation des webhooks) | à fournir par Cabrel | S10 |
| 14 | « Lire d'autres avis » sur l'accueil (pas de page témoignages) | dépliage sur place, sans nouvelle page | S5 |
| 15 | Site marketing de Brandself (`/`) : maquette à produire | page provisoire | S12 |

## 4. Décisions tranchées (résumé ; détail dans PROJECT_CONTEXT.md)

Promesse « vitrine » · vocabulaire · sections fixes sans blocs · Nuxt fullstack, PostgreSQL, Drizzle, BullMQ + Redis, Better Auth · pas de mot de passe (Google, email, téléphone, OTP) · types de services et paiement flexible (paiement en ligne par Brandself reporté à la v1.5) · 5 entrées de navigation · pages publiques conditionnées au contenu · agenda visuel sur l'accueil · mise en vedette (3 max) · interrupteurs de visibilité et de réglage · direction éditoriale chaleureuse, 5 palettes, Fraunces + Figtree, Phosphor, vouvoiement · mots de titre ni colorés ni en italique · plan gratuit limité + plan payant prépayé avec renouvellement manuel et rappels · rétention en 5 mécanismes · images en local derrière une couche de stockage · bibliothèque d'abord.

## 5. Maquettes

Référence : https://claude.ai/artifact/K6zesargm7HjPqwuaHd4rc (32 écrans : vitrine mobile/tablette/PC, services, réalisations, réservation, liens, studio, inscription, connexion par code, compte, tarifs).
**À faire avant S2** : exporter chaque écran en image (ou en HTML) dans `docs/maquettes/` avec le nom de l'écran, car l'agent de code ne peut pas ouvrir le lien. Les sprints citent les écrans par leur nom (ex. `Studio-Services`, `Service-Detail-PC`).
Les textes entre crochets (`[Prix]`, `[numéro]`, `[Témoignage d'un patient]`) sont des espaces réservés, et les chiffres du studio (128 visites…) sont des exemples d'affichage.

## 6. Risques et vigilance

- **Le mélange refait surface** : toute idée nouvelle passe par PROJECT_CONTEXT.md avant d'arriver dans le code.
- **Le worker BullMQ** tourne dans un process séparé : à superviser (PM2) et à tester tôt (S0).
- **Les images en local** : prévoir des sauvegardes régulières du dossier dès S2.
- **La route `@username`** : validée en S1 (e2e : `/@dr-cabrel` et `/dr-cabrel`), repli `/l/username` non nécessaire pour l'instant.
- **Les OTP** : coût et fiabilité des SMS, protection contre l'abus (limites par IP et par identifiant).
- **K-PAY** : pas de SDK Nuxt, pas de renouvellement automatique ; documentation et sandbox à obtenir avant S10.
- **Priorité** : le cœur (connexion → vitrine publiée → réservation) avant tout le reste. Ne pas spécifier ni construire de fonctionnalité périphérique plus détaillée que le cœur.

## 7. Dette connue

- `useAuthClient()` null côté SSR (le composant du module ne fournit le client que côté client) : garde null dans les handlers des pages de connexion.
- Rate-limit Better Auth désactivé sur les paths d'envoi OTP (`customRules: false`) : notre garde Redis (10/min IP, 1/60s identifiant) fait foi ; pas de double gouvernance en mémoire.
- `otp-limiteur` lit et republie le corps de la requête pour Better Auth (`event.web.request`) : fragile si le module change `toWebRequest` — à surveiller.
- Hydration lente (~54 s au 1er load sur cette machine) : les tests e2e attendent `__vue_app__` avant d'interagir ; `playwright.config.ts` : `workers: 1`, `timeout: 120s`, `expect.timeout: 15s`.
- `dayjs` était déclaré mais absent de `package.json` : ajouté en dépendance directe (corrige le crash UMD de l'hydratation client).
- `vue-qrcode-reader` non installé : avertissement `optimizeDeps.include` inoffensif, rien ne l'importe (S9+).
- Pages publiques : `/` = placeholder (à remplacer par l'accueil maquetté en S2).
- `storeOTP: 'plain'` en dev / `hashed` en prod : vérifier le comportement hashed en production (S13).
- Migrations par `drizzle-kit` (pas de `down` généré) : les scripts du kit multi-agent qui attendent les marqueurs dbmate `-- migrate:up/down` ne s'appliquent pas ; réversibilité par migration forward (à accepter explicitement).
- `pnpm typecheck` ~8 min sur cette machine (vue-tsc) : acceptable, à surveiller en CI.
- Worker en production : PM2 lance `tsx` (interpréteur TS) — à valider en S13 (un build dédié esbuild serait plus propre).
- `drizzle-zod` non installé : vient avec S1 (premiers schémas) — rien à installer « au cas où ».
- Environnement local : PostgreSQL dédié au projet (`~/.pgdata-brandself`, port 5433, démarré par `pg_ctl`) car ni Docker ni rôle `cabrel` sur le cluster système ; `docker-compose.yml` reste la référence pour toute autre machine.
- Tailwind importé (`main.css`) mais aucun composant ni variable de palette : le design system arrive en S2.
- **Dette corrigée en S1** : tous les identificateurs de code (fonctions, variables, types, tests) sont passés en anglais ; seul le texte affiché reste en français.

## 8. Historique

- 2026-10-23 : cadrage terminé, documents PROJECT_CONTEXT.md, CLAUDE.md, PROJECT_STATE.md et SPRINTS.md rédigés.
- 2026-10-24 : S0 Fondations livré (build 13m18s, lint/typecheck/test/e2e verts ; worker et job `ping` prouvés ; dépôt poussé sur GitHub `cabrel7/brandself-new`).
- 2026-10-25 : S1 Authentification livré (build 16m56s, lint/typecheck/test/e2e verts, 8/8 e2e ; branche `sprint/s1-authentification`, mergé sur `main`).
- 2026-10-25 : S2 Studio/Profil/Accueil livré (typecheck/lint/tests verts ; composants design system sur variables CSS, API studio + publique, migrations vitrines/medias, upload sharp) ; branche mergée sur `main`.
