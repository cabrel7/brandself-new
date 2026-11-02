# PROJECT_STATE.md — Brandself

Dernière mise à jour : **2026-11-02** · Phase : **reprise sprint par sprint** · S0–S7 validés · **S7-bis implémenté** (agenda/contact/messages) sur la branche `sprint/s6-s7-s7bis` (commits `86afce1`, `0e9868f`) : lint/typecheck verts, unit 1647, intégration 612, e2e `messages` 8/8, `studio-agenda` 8/8, `reservation`/`studio-auth` verts. **Build prod OK 2026-11-02 (19m16s, pic 2,1 Go)**. **Reste** : run e2e complet (tué par manque de mémoire, à relancer machine libre), captures 390/768/1280 vs maquettes, puis merge. Éléments non bloquants reportés à la passe d'optimisation avant prod : voir §7 « Avant mise en prod ».

À traiter plus tard (décision 2026-10-31) : sur l'accueil, ne garder à terme que **l'agenda du jour courant** dans le bloc ; l'agenda complet vit sur la page publique `/agenda`. Ne pas modifier le bloc actuel pendant S7-bis.

À mettre à jour à la fin de chaque sprint (statut, décisions prises, décisions ouvertes, dette connue).

## 1. Contexte de la refonte

L'ancien projet (Laravel + Nuxt, système de blocs polymorphique, ~60 tables, documents contradictoires) est abandonné au profit d'un **nouveau projet Nuxt fullstack** au périmètre réduit. La base technique de l'ancien projet n'est pas reprise en code ; certaines idées sont reprises (voir PROJECT_CONTEXT.md). Les anciens documents sont des archives (`docs/archive/`).

## 2. Avancement des sprints

| Sprint | Domaine | Statut | Jalon |
|---|---|---|---|
| S0 | Fondations | **repris, fait** | base (btree_gist actif), worker BullMQ (file `systeme`, job `ping`), `/api/health`, Zod au démarrage, Vitest + Playwright + CI, lint/typecheck/build verts |
| S1 | Authentification (OTP, Google) | **repris, fait** | connexions email/téléphone + code 6 chiffres, garde OTP Redis, pages `/connexion`, `/connexion/code`, `/studio`, onboarding, vitrines statiques `@username`/`[username]`, e2e 8/8 verts |
| S2 | Studio (coque), Profil, accueil public | **repris, fait** | Backend refait (services, resources, `defineApiHandler`, médias sharp+unstorage, suppression de compte, appareils, routes un-dossier-par-ressource), fuite PII fermée, studio/profil/compte/vitrine publique/onboarding sur `@nuxt/ui`, 5 palettes. 370 tests unit, 157 intégration, 97 e2e verts ; build OK (RESEND_API_KEY requis). Écarts maquette restants : voir docs/JOURNAL_DECISIONS.md |
| S3 | Services | **repris, fait** | Schéma + migration 0010 (CHECK, slug par vitrine, FK image), service/ressources/8 routes, studio (liste, tri clavier+glisser, vedettes ≤3, formulaire), pages publiques (accueil à la une, liste, détail, /reserver provisoire). 802 unit, 318 intégration, 162 e2e verts ; build OK. Écarts maquette : docs/JOURNAL_DECISIONS.md |
| S4 | Réalisations | **fait** | schéma `realisations`, API studio (POST/GET/PUT/DELETE), API publique (liste + détail), pages studio (grille, création, modification, reorder clavier), pages publiques (liste, détail). 1697 unit, 42 fichiers intégration, e2e médias/public/connexion/realisations verts ; build prod OK (RESEND_API_KEY + NUXT_PUBLIC_SITE_URL requis). Correctifs : CA21 413 avant lecture du corps (artefact dev Vite contourné), CA33 stack masquée pour les DomainError, timeouts redirection /studio (hydration ~30s). |
| S5 | Témoignages | **fait, durci** | migration 0014 (slug unique par vitrine), schémas create/update sans défauts parasites, routes dossier fines + service/resource, studio aligné Réalisations (liste, tri, visibilité, formulaires), bloc public sur l'accueil avec dépliage, e2e parcours complet 6/6 + intégration 19 tests |
| S6 | Liens et link-in-bio | **fait** | migration 0013 (slug par vitrine), CRUD + ordre + visibilité + clics hebdomadaires, studio (carte partage, copie, QR modal+téléchargement, formulaire 6 types), `/@username` conforme maquette, clic natif non bloquant, e2e liens 9/9, captures 390/1280 |
| S7 | Agenda, réservations, demandes | **fait** | schéma 0015/0016 (exclusion GiST, token SHA-256 hashé), service de créneaux (Temporal, fuseaux), routes studio + publiques, `/reserver` + confirmation + e-mails, Studio agenda, nav +Agenda, captures 390/768/1280. **Durcissement post-review** : 23505 → 409, anti-spoof IP (helper client-ip + Nginx versionné + loopback PM2), HTML confirmation `private, no-store`, limite contact 3/24 h hachée, e2e répétables (purge Redis), timeout webServer 300 s. Gates 2026-10-31 : lint/typecheck verts, Vitest 2087/2087, intégration 563/563, e2e 268/268, build prod 11m22s. Écarts assumés + findings : voir §7. **Fin S7 : bêta fermée** (avec S8 pour l'inscription guidée) |
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
| 10 | `@nuxt/ui` comme base de composants ou composants maison | **`@nuxt/ui` comme base** (UButton, UInput, USwitch…), thémé sur les variables CSS des 5 palettes ; `Bs*` = surcouches métier uniquement. Révisé le 2026-10-26 (remplace « composants maison » de S2) ; migration des `Bs*` en cours | S2 ↻ |
| 11 | Fournisseur et modèle d'IA | interchangeable ; à choisir | S8 |
| 12 | Hébergement, nom de domaine, serveur de courriels de production | VPS Ubuntu existant | S13 |
| 13 | Accès sandbox K-PAY (clés, documentation des webhooks) | à fournir par Cabrel | S10 |
| 14 | « Lire d'autres avis » sur l'accueil (pas de page témoignages) | dépliage sur place, sans nouvelle page | S5 |
| 15 | Site marketing de Brandself (`/`) : maquette à produire | page provisoire | S12 |

## 4. Décisions tranchées (résumé ; détail dans PROJECT_CONTEXT.md)

Promesse « vitrine » · vocabulaire · sections fixes sans blocs · Nuxt fullstack, PostgreSQL, Drizzle, BullMQ + Redis, Better Auth · pas de mot de passe (Google, email, téléphone, OTP) · types de services et paiement flexible (paiement en ligne par Brandself reporté à la v1.5) · 5 entrées de navigation · pages publiques conditionnées au contenu · agenda visuel sur l'accueil · mise en vedette (3 max) · interrupteurs de visibilité et de réglage · direction éditoriale chaleureuse, 5 palettes, Fraunces + Figtree, Phosphor, vouvoiement · mots de titre ni colorés ni en italique · plan gratuit limité + plan payant prépayé avec renouvellement manuel et rappels · rétention en 5 mécanismes · images en local derrière une couche de stockage · bibliothèque d'abord · **(S7)** réservation `en_attente` valable jusqu'à l'action du professionnel (le jeton 30 min n'expire que le récapitulatif) + plafond de création par contact 3/24 h par vitrine (email et téléphone hachés, fail-closed), en plus du plafond IP ; limites `en_attente` sans OTP avant S8/S13.

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

### Avant mise en prod (passe d'optimisation, décision 2026-11-02 : non bloquant, à traiter ensemble)

- Plafond par vitrine des messages (`message-vitrine:{username}`) compté **avant** de vérifier que la vitrine existe : chaque nom inventé crée une clé Redis (TTL 1 h), bornée seulement par la limite IP. Contrôler l'existence d'abord ou borner la cardinalité.
- `server/services/limiteur.ts` : une erreur de commande `INCR` dans `multi().exec()` est renvoyée, pas levée ; le compteur est lu à 0 et la requête passe malgré `failClosed`. Vérifier les erreurs du résultat de `exec()`.
- Anti-injection d'en-têtes : `singleLine()` couvre l'objet, « De : » et « Visiteur : » mais pas `Email :` ni `Motif :` (protégés seulement par Zod en amont). Étendre la garde.
- `typeLibelle` ('Réservation' / 'Demande') dans `useStudioAgenda.ts` : champ mort (plus affiché). Supprimer ou réafficher selon la maquette.
- Plafond par vitrine appliqué avant Zod : un attaquant multi-IP peut bloquer 1 h les messages d'une vitrine. `listOwnMessages` sans pagination au-delà de 200.
- Hook `.claude/hooks/subagent-test-gate.sh` : `vitest related` lance aussi le projet integration sans `DATABASE_URL` (« Startup Error ») ; correctif possible `--project unit`, non appliqué (garde de sécurité, accord requis).
- Base `brandself_dev` désynchronisée : à recréer (non fait). `PAIEMENT_EN_LIGNE=false` à confirmer dans `.env.example`.
- Dev : derrière `nuxt dev`, l'IP du socket est « inconnue » (proxy) ; les e2e remettent à zéro le compteur `limite:message-publique:*` (`reinitialiserLimites`). Hero ne transmet plus `debut` vers `/agenda`.
- Décisions utilisateur en attente : valider les écarts maquette et décisions par défaut (#16–67 du journal), merger `sprint/s6-s7-s7bis`, relancer ou non le `vite preview` d'agent-office tué par erreur.

### Autres

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

### Findings de review S7 (4 reviews : reviewer, security, ux-reviewer, regression-checker — 0 CRITICAL, 0 BLOQUANT)

**Corrigés :**

| # | Source | Finding | Correction |
|---|---|---|---|
| A | reviewer MAJOR-1 | violation unique `indisponibilites_vitrine_id_date_unique` non mappée → 500 au lieu de 409 | mappage 23505 → `INDISPONIBILITE_EXISTANTE` (409), test intégration RED/GREEN |
| B | reviewer MAJOR-2 = regression R1 | ancre `#agenda` morte si les créneaux générés sont vides | cible et nav alignées sur `contenus.agenda`, état vide conservé, e2e ciblé vert |
| C | ux-reviewer MAJEUR | « Contact » atterrit sous la nav sticky | `Pied.vue` : `scroll-mt-24`, e2e ciblé vert (géométrie + style calculé à 390/768/1280) |
| D | security HIGH-1 | clé rate-limit sur un `X-Forwarded-For` directement fiable | helper `client-ip` : header accepté uniquement depuis le proxy loopback, quatre consommateurs migrés, Nitro lié à `127.0.0.1`, snippet Nginx versionné (`deploy/nginx/brandself-location.conf`, `X-Forwarded-For $remote_addr`) + test |
| E | security (2e revue) MEDIUM | HTML SSR de la confirmation sans `Cache-Control` (charge utile dépendante d'un cookie) | page confirmation : `private, no-store` (`useResponseHeader`), preuve e2e sur le document HTML |
| F | security (2e revue) HIGH | blocage abusif de créneaux par contacts non vérifiés | décision tranchée (§4.16) : limite contact 3/24 h par vitrine (email + téléphone hachés SHA-256, fail-closed), tests unit + intégration Redis |
| G | regression (2e revue) | e2e non répétables : compteurs `limite:*` jamais nettoyés, démarrage à froid 2m47s > timeout 120 s | `global-setup` purge `limite:*` dans Redis ; `playwright.config.ts` webServer timeout 300 s |
| H | security (2e revue) LOW | message 429 « quelques instants » trompeur pour un retryAfter jusqu'à 24 h | `useApiErreur` expose `retryAfter` ; message dynamique (instants / minutes / heures) |

**Finding HIGH-2 (auto-annulation) rejeté après vérification métier :** `confirmation_expire_le` expire uniquement l'accès privé au récapitulatif (30 min), pas la demande. S7 exige qu'une réservation `en_attente` bloque le créneau jusqu'à confirmation ou annulation par le professionnel. Un job fondé sur cette colonne annulerait silencieusement de vraies demandes. Un test PostgreSQL prouve que l'expiration du récapitulatif conserve `en_attente` et le blocage.

**Risques résiduels acceptés pour la bêta fermée** (à revoir avant S13) : contacts rotatifs et rotation IPv6 contournent les limites ; les compteurs contact sont incrémentés avant la validation métier (3 requêtes valides mais impossibles bloquent un contact 24 h — empoisonnement, atténué par le plafond IP) ; SHA-256 sans secret (HMAC recommandé) et IP en clair dans les clés Redis ; bloc Nginx complet (HSTS, headers, redirection HTTP, sauvegardes) hors dépôt, à auditer au déploiement ; endpoint `creneaux` sans limite de débit ; ICS d'une réservation `en_attente` sans `STATUS:TENTATIVE` ; `hitLimit` ignore les erreurs MULTI/EXEC ; codes OTP journalisés en clair dans les replis de développement/SMS.

**Reportés (sous MAJOR, non corrigés dans cette session) :**

- reviewer : **12 MINOR** — liste complète non conservée (sortie agent tronquée) ; à relire depuis la session avant S8 si nécessaire.
- regression R2 : commentaire périmé `nuxt.config.ts:11-13` (module qrcode réajouté depuis).
- regression R3 : `e2e/api/studio-auth.spec.ts` ne couvre pas les 9 routes studio S7 en 401.
- regression R4 : 13 fichiers `capture-*.png` non trackés à la racine (regénérés par `pnpm e2e`, jamais ajoutés) — à ne **pas** committer, ou à déplacer hors racine avant le prochain commit.
- regression R5 : spec `docs/specs/S4-realisations.md:114,426,451,529,675,837` décrit encore le DTO contenus à 2 champs (3 depuis le drapeau `agenda`).
- ux MINEUR (10) : `Réserver` = `<a href>` brut (→ NuxtLink + hover thémé) ; pas de `aria-current` sur la marque à l'accueil ; aria-label jours sans info « créneaux disponibles » (`AgendaPublic.vue:228-249`) ; bouton Confirmer en `v-if` (`AgendaPublic.vue:278-280`) ; textarea thème `xl` ; pas d'`aria-live` sur le succès de confirmation ; redite sous-titre page confirmation ; `role=alert` redondant ; `gap-5` hors échelle d'espacement ; texte confirmation demande ≠ maquette.
- security MEDIUM-3 : endpoint `creneaux` non rate-limité. La plage n'est pas plafonnée par Zod, mais `computeCreneaux` la borne déjà à `horizonJours` (maximum 365) : le DoS CPU annoncé n'est pas reproduit ; ajouter une limite de débit avant S13 reste recommandé.
- security MEDIUM-4 : les replis OTP journalisent identifiant + code en clair (`SenderOtpEmail` en développement, `SenderOtpSms` sans garde de production) ; à supprimer avant S13.
- security LOW : `timingSafeEqual` sur hash de jeton (timing sur inégalité de longueur, négligeable côté SHA-256 fixe), cookie de confirmation non `Secure` en dev, réservations par visiteur non bornées (plafond à définir), `professionalRecipient` en repli d'envoi.
- guard-rule proposée dans `ISSUES.log` (contraste/tokens UI) : **non appliquée**, à trancher avec l'utilisateur.

## 8. Historique

- 2026-10-23 : cadrage terminé, documents PROJECT_CONTEXT.md, CLAUDE.md, PROJECT_STATE.md et SPRINTS.md rédigés.
- 2026-10-24 : S0 Fondations livré (build 13m18s, lint/typecheck/test/e2e verts ; worker et job `ping` prouvés ; dépôt poussé sur GitHub `cabrel7/brandself-new`).
- 2026-10-25 : S1 Authentification livré (build 16m56s, lint/typecheck/test/e2e verts, 8/8 e2e ; branche `sprint/s1-authentification`, mergé sur `main`).
- 2026-10-25 : S2 Studio/Profil/Accueil livré (typecheck/lint/tests verts ; composants design system sur variables CSS, API studio + publique, migrations vitrines/medias, upload sharp) ; branche mergée sur `main`.
- 2026-10-27 : S4 Réalisations livré et validé (schéma realisations, API studio+publique, pages studio+publiques). 5 fichiers corrigés : `server/utils/api.ts` (stack masquée DomainError → CA33), `e2e/connexion.spec.ts` (timeouts redirection /studio, hydration ~30s), `e2e/realisations.spec.ts` (timeout session expirée), `e2e/api/medias.spec.ts` (CA21 413 avant lecture du corps, contournement artefact dev Vite), `e2e/helpers/session.ts` (agent:false dans requeteBrute). Vitest 1697/1697, lint et typecheck verts, build prod OK (15m43s). E2E complet : 227/227 verts, 0 échec.
- 2026-10-27 : S5 Témoignages livré et validé (table existante, service/ressource/DTO, routes studio dont `reordonner`, API publique, bloc témoignage sur l'accueil avec dépliage clavier, seed 3 témoignages espaces réservés). Fichiers : `shared/dto/temoignage.ts` (créé), `shared/dto/index.ts`, `shared/schemas/temoignage.ts`, `shared/erreurs.ts`, `server/exceptions/http.ts`, `server/services/temoignages.ts` (créé), `server/services/temoignages-regles.ts` (créé), `server/resources/temoignage.ts` (créé), `server/api/studio/temoignages/post.ts` (refactorisé), `server/api/studio/temoignages/reordonner.post.ts` (créé), `server/api/public/[username]/temoignages/index.get.ts` (créé), `app/composables/usePublicTemoignages.ts` (créé), `app/components/vitrine/TemoignageALaUne.vue` (créé), `app/pages/studio/temoignages/nouveau.vue` (slug généré côté client), `app/pages/[username]/index.vue` (bloc témoignage), `server/db/seed.ts` (3 témoignages). Vitest 1699/1699, lint et typecheck verts, build prod OK, E2E complet 227/227 verts. (Test e2e parcours complet témoignage à ajouter.)
- 2026-10-30 : S5 durci + S6 livré (témoignages studio refaits, migrations 0013/0014, routes legacy retirées, link-in-bio et studio liens conformes maquettes, QR téléchargeable, clics hebdomadaires). Gates : lint/typecheck verts ; Vitest 1855/1855 ; intégration 526/526 ; Playwright 248/248 ; build prod 10m19s ; captures 390/1280 validées.
- 2026-10-31 : S7 Agenda/réservations/demandes livré et durci (migrations 0015/0016 ; 2 revues de review security/ux/regression/reviewer). Correctifs : prix + lieu sur la confirmation, nav Agenda/Contact, 23505 → 409 `INDISPONIBILITE_EXISTANTE`, ancre agenda pilotée par `contenus.agenda`, anti-spoof XFF (`server/utils/client-ip.ts` + Nginx loopback), confirmation `private, no-store`, limite contact réservation 3/24 h (SHA-256, fail-closed), e2e répétables (purge `limite:*`) et webServer 300 s, message 429 dynamique. HIGH-2 (auto-annulation à 30 min) rejeté avec preuve PostgreSQL. Gates : lint/typecheck verts ; Vitest 2087/2087 ; intégration 563/563 ; e2e 268/268 (36m21s) ; build prod 11m22s.
- 2026-11-02 : S7-bis (agenda public/studio, contact, messages) implémenté et revu (sécurité, UX, régression). Correctifs : plafond 30 messages/h/vitrine fail-closed, liste bornée à 200, verrous `FOR UPDATE OF`, injection d'en-têtes par le nom, message de succès persistant, liens « Réserver » → `/agenda`. Page Disponibilités déplacée en `agenda/index.vue` + `agenda/disponibilites.vue` (sans `<NuxtPage />` le parent masquait l'enfant). E2E réalignés sur l'UI (onglets sans compteur, `h4`, onglet Demandes, « Fermé »). Run e2e complet interrompu par manque de mémoire.
