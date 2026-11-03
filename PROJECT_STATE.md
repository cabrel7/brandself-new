# PROJECT_STATE.md — Brandself

Dernière mise à jour : **2026-11-02** · Phase : **reprise sprint par sprint** · S0–S7 validés · **S7-bis implémenté** (agenda/contact/messages) sur la branche `sprint/s6-s7-s7bis` (commits `86afce1`, `0e9868f`) : lint/typecheck verts, unit 1647, intégration 612, e2e `messages` 8/8, `studio-agenda` 8/8, `reservation`/`studio-auth` verts. **Build prod OK 2026-11-02 (19m16s, pic 2,1 Go)**. **e2e 2026-11-02 par groupes : `e2e/api` 199/199, pages/services/réalisations/liens/témoignages 69/69 (après correctif de `services.spec.ts`), messages 8/8, studio-agenda 8/8, reservation et captures verts.** Comparaison aux maquettes faite (voir §7). **Reste** : merge de `sprint/s6-s7-s7bis`. Éléments non bloquants reportés à la passe d'optimisation avant prod : voir §7 « Avant mise en prod ».

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
| S8 | Inscription guidée + IA | **mergé sur `main` (079de8c)** | branche `sprint/s8-onboarding-ia` : migration 0018 (`prompts_ia`, `generations_ia`, `progressions_inscription`), service IA (fournisseur interchangeable, repli, garde-fous, job BullMQ), routes onboarding/ia, parcours `/onboarding` en 4 étapes, « Améliorer avec l'IA » au Profil, prochaine étape « Ouvrez vos disponibilités ». Gates 2026-11-02 : lint/typecheck verts, unit 2338, intégration 1001, e2e API 113/115 puis connexion 7/7, e2e UI S8 17/17 (avant passage sur Gemini), **build prod OK (10m13s, pic 2,1 Go)**. Revues sécurité/UX/régression faites et corrigées. **Reste** : prompt v2 (accents), **rejouer les e2e S8 avec `IA_FOURNISSEUR=faux`** (le code a changé depuis leur dernier passage : adaptateur compatible OpenAI, migration 0019, réouverture de l'inscription ; couverts par unit/intégration mais pas par l'e2e), captures vs maquettes ; dette S8 en §7 |
| S9 | Notifications et rétention | **repris, fait** | Outbox planifiée (occurrence, catégorie, statut annule), rappel visiteur 24 h, rendez-vous du jour, résumé hebdo, désabonnement HMAC, prochaine étape (étape partager), partage vitrine, préférences e-mail au Compte, migration 0020, jobs planifier/purger, limiteur Resend. Gates 2026-11-03 : lint, typecheck verts ; unit 2702/2702 ; intégration 1243/1243 (0 sauté) ; e2e S9 interface 21/21 + API/studio-auth verts. **Post-revue** : files séparées (`messages-auth` sans limiteur, `emails-notifications` limitée, `maintenance`, `ia`, `system`), rappel annulé si vitrine dépubliée, désabonnement POST avec repli sur la query + budgets GET/POST. Reste : build, merge `sprint/s9-notifications` sur `main`. |
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
| 6 | Photo obligatoire à l'inscription | obligatoire (**appliquée en S8**) | S8 ✅ |
| 7 | Essais de code OTP, durée, renvoi | 3 essais, 10 min, renvoi après 60 s | S1 |
| 8 | Statistiques : gratuit vs payant | gratuit 7 jours ; payant 90 jours avec pages et sources | S11 |
| 9 | Langue des identifiants de code | **appliqué en S0** : tables/champs d'API en français sans accents, code TypeScript en anglais | S0 ✅ |
| 10 | `@nuxt/ui` comme base de composants ou composants maison | **`@nuxt/ui` comme base** (UButton, UInput, USwitch…), thémé sur les variables CSS des 5 palettes ; `Bs*` = surcouches métier uniquement. Révisé le 2026-10-26 (remplace « composants maison » de S2) ; migration des `Bs*` en cours | S2 ↻ |
| 11 | Fournisseur et modèle d'IA | **tranché par défaut en S8** : interface interchangeable + adaptateur Anthropic (`claude-haiku-5-5`), faux fournisseur en dev/test ; à confirmer (modèle, coût, conservation) avant la production | S13 |
| 12 | Hébergement, nom de domaine, serveur de courriels de production | VPS Ubuntu existant | S13 |
| 13 | Accès sandbox K-PAY (clés, documentation des webhooks) | à fournir par Cabrel | S10 |
| 14 | « Lire d'autres avis » sur l'accueil (pas de page témoignages) | dépliage sur place, sans nouvelle page | S5 |
| 15 | Site marketing de Brandself (`/`) : maquette à produire | page provisoire | S12 |
| 16 | ~~Tests S8 `ia-fournisseurs` en échec~~ | **résolu 2026-11-03** : cause réelle = `EMAIL_EXPEDITEUR`/`NUXT_PUBLIC_SITE_URL` requis en production et absents du test (corrigé), pas le `.env` | — |

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
- Comparaison maquettes 2026-11-02 : Agenda public mobile/PC corrigé (titre du mois 1 ligne, créneaux 3 colonnes, pied 1 rangée, contour « Réserver » retiré). Studio Disponibilités : interrupteur par jour ajouté (écart spec §28 / règle Switch), « + Ajouter une plage » réservé aux jours ouverts, icône du bouton Disponibilités retirée. Écarts résiduels assumés : champs heure en 24 h (artefact « AM/PM » de la maquette), carte « Vous préférez réserver ? » avec titre en police de titres, lignes Email/Téléphone/WhatsApp absentes sur la démo `dr-cabrel` (données non publiées), avatar du Studio en icône générique (maquette : initiale), liste des jours des Disponibilités encadrée d'une carte (maquette : liste à plat). Pas de maquette pour Studio · Messages.
- e2e en dev : l'hydratation à froid du studio dépasse 25 s ; les tests qui attendent une redirection client ne doivent pas recharger la page avant ~70 s (corrigé dans `services.spec.ts`).
- Dev : derrière `nuxt dev`, l'IP du socket est « inconnue » (proxy) ; les e2e remettent à zéro le compteur `limite:message-publique:*` (`reinitialiserLimites`). Hero ne transmet plus `debut` vers `/agenda`.
- Décisions utilisateur en attente : valider les écarts maquette et décisions par défaut (#16–67 du journal), merger `sprint/s6-s7-s7bis`, relancer ou non le `vite preview` d'agent-office tué par erreur.

### Dette S8 (à traiter avant la production)

- Plafond global IA (2000/j) compté par génération et non par tentative (une sortie invalide coûte jusqu'à 3 appels) ; surveiller `tokens_entree`/`tokens_sortie` par jour.
- `IA_CLE_API` parsée par `shared/env.ts` dans tout processus : ne la fournir qu'à l'unité de déploiement du worker.
- Pas de limiteur sur `GET /api/studio/generations/:id` (suivi toutes les 2 s, 60 s max côté client).
- Token de succès `--succes` absent de `main.css` (« adresse disponible » en `accent-texte`) ; Métier du Profil encore en `UInput` simple (suggestions seulement à l'inscription).
- UX mineurs non traités : barre d'action fixe et clavier mobile à vérifier en 390×664, contraste des segments de progression, nom/étiquettes des maquettes (voir revue).
- Lockfile : `@anthropic-ai/sdk` ajoute `@opentelemetry/api` (peers réécrits) : vérifier `pnpm install --frozen-lockfile` en CI.
- `.env.example` : ajouter `IA_FOURNISSEUR=` (anthropic | openai | faux | aucun ; `openai` = tout fournisseur compatible OpenAI), `IA_CLE_API=`, `IA_MODELE=` (obligatoire avec `openai`), `IA_BASE_URL=` (optionnelle, HTTPS) ; `CLAUDE.md` §8 : `@anthropic-ai/sdk`.
- Page Confidentialité : mentionner les données envoyées au fournisseur d'IA (métier, ville, pays, textes de présentation).

### Dette S9 (écarts maquettes, à valider — voir spec §7.7)

1. Partie « E-mails » au Compte : absente de la maquette Studio-Compte.
2. Bouton « Ne plus proposer cette étape » : absent de la maquette Studio.
3. « Autres façons de partager » sur En ligne : absent de la maquette Inscription-Fin.
4. Interrupteur du rappel désactivé par défaut (la maquette Réservation le montre activé — écart #85, décision à trancher).
5. Maquette Studio montre « Ajoutez un premier témoignage » comme prochaine étape, absente de l'ordre SPRINTS (photo→service→disponibilités→réalisation→partager).
6. Statistiques de l'accueil du studio restent à 0/0/0 en dur (S11 les rendra réelles — affichage trompeur en attendant).
7. Variables `.env` requises en production (`EMAIL_EXPEDITEUR`, `NUXT_PUBLIC_SITE_URL`) absentes de `.env` local : le build `nuxt build` (force `NODE_ENV=production`) les exige ; passer en CLI ou les ajouter à `.env` (non committé).

### Dette S9 après revues (2026-11-03)

- Rappel visiteur : pas de lien d'opposition (risque d'abus par un tiers, mitigations en spec §14 entrée 10).
- Clé v2 du jeton de désabonnement : documentée, non implémentée ; une rotation de `NUXT_BETTER_AUTH_SECRET` invalide les jetons ≤ 90 j (spec, « Notes de déploiement S9 »).
- Worker de transition sur l'ancienne file `emails` (`FILE_EMAILS_LEGACY`) : **à retirer à la release suivante**. Déployer app + worker ensemble.
- Constantes de temps encore dupliquées : `MS_PAR_JOUR` (`onboarding.ts`, `ia/generations.ts`), `MINUTE_MS` (`creneaux.ts`), `60_000` (`reservations.ts`), supports de tests ; `libelleSeances(1)` → « 1 séances ».
- Labels de champ « Email » (ReservationForm, DemandeForm, ContactMessageForm) à passer en « E-mail » avec `e2e/messages.spec.ts` et `e2e/reservation.spec.ts`.
- « Me connecter » du désabonnement expiré : pas de redirection après connexion (callback `/onboarding` en dur) ; CA60 dit « lien vers le compte », spec §7.6 dit `/connexion`.
- `terminer` (onboarding) répond « proposition manquante » pour un service `rdv` sans `dureeMin` : message trompeur (`onboarding-regles.ts:96`, `onboarding.ts:514`).
- Panneau « un seul message » carte prochaine étape / `messagePublication` : non couvert en e2e.
- Opérations hors CI : `.github/` non vérifié pour les tests d'intégration S9 (CI : variables de production ajoutées).
- nginx : logs sans query string pour `/api/public/desabonnement`, `client_max_body_size 2k`.

### Essai réel du fournisseur d'IA (2026-11-02)

- Gemini via l'adaptateur compatible OpenAI : **fonctionne de bout en bout** (`IA_FOURNISSEUR=openai`, `IA_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `IA_MODELE=gemini-3.5-flash-lite`) : génération `terminee`, ~9 s, 2218 tokens en entrée / 857 en sortie. Le schéma d'outil est accepté par Gemini.
- Modèles : `gemini-2.5-flash` n'est plus ouvert aux nouveaux comptes (404) ; `gemini-3.8-flash` trop lent (>90 s, hors budget 25 s) ; `gemini-3.5-flash-lite` (2,3 s) et `gemini-3.1-flash-lite` (4,5 s) conviennent.
- **À corriger — prompt v2** (en base, `prompts_ia`, nouvelle version via migration/seed) : le modèle écrit parfois sans accents (« reference », « sante », « exercant ») dans les services et la présentation ; ajouter une consigne explicite de français correct avec accents, puis retester ; comparer `gemini-3.1-flash-lite`.
- Une première réponse a été rejetée par le garde-fou `faits_inventes` avant la bonne (second appel facturé) : normal, à surveiller via `tokens_*`.
- **e2e S8 déterministes** (panne, lente, invalide, invente) : exigent `IA_FOURNISSEUR=faux` (faux fournisseur) ; avec Gemini configuré dans `.env` ils ne sont pas rejouables tels quels.
- Migrations 0018 et 0019 appliquées à la base de dev (sur accord de l'utilisateur).

### À rendre configurable depuis le futur panel admin (règle de l'utilisateur : aucune valeur en dur)

Aujourd'hui ce sont des constantes nommées dans `shared/` ou `server/config/` (jamais de littéral dans un composant ou une route), modifiables seulement par déploiement :
- **IA** : fournisseur, modèle, adresse de l'API (`IA_*` en environnement) ; limites (10 demandes/h par utilisateur, plafond global 2000/j), quota gratuit (3/mois), délais (budget 25 s, expiration 45 s, 3 tentatives), rétentions (30 j textes IA, 90 j inscriptions abandonnées), longueurs imposées (accroche 10–15 mots, présentation 80–260).
- **Prompts IA** : déjà en base (`prompts_ia`, versionnés, réglages de température et de longueur dans la ligne) : le panel n'aura qu'à les éditer et activer une version.
- **Plans** (gratuit/payant, limites de contenu et d'IA) : `server/config/plans.ts` → table de configuration lue par `PlanService`.
- Autres limites déjà nommées : limiteurs (OTP, messages, réservations, contact, adresse), plafonds de listes (200 messages…), horizons et préavis par défaut de l'agenda.
- Fournisseur IA enregistré en colonne libre (`generations_ia.fournisseur`, CHECK de format seulement) : un nouveau fournisseur n'exige plus de migration.

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
- 2026-11-03 : S9 Notifications et rétention implémenté (branche `sprint/s9-notifications`, 10 commits + corrections e2e) : outbox planifiée (occurrence, catégorie, statut annule), rappel visiteur 24 h, rendez-vous du jour, résumé hebdo, désabonnement HMAC, prochaine étape « partager », partage vitrine, préférences e-mail au Compte, migration 0020, jobs planifier/purger, limiteur Resend. Gates vertes : lint, typecheck, unit 2678/2678, integration S9 265/265, build 12m50s, e2e API notifications + studio-auth. Corrigé : titres de test dupliqués dans `e2e/api/studio-auth.spec.ts`. Reste : committer `.env.example` + `studio-auth.spec.ts`, merger `sprint/s9-notifications` sur `main`, merger `sprint/s6-s7-s7bis` (en attente).
- 2026-11-03 (suite) : revues S9 (sécurité tier critique : 0 CRITICAL/MAJOR, 8 MINOR ; régression : variables de production en CI corrigées ; UX 8,5/10). Corrigé : files d'attente séparées (OTP jamais derrière les résumés), purges en file `maintenance`, rappel annulé si vitrine dépubliée, POST désabonnement tolérant, budgets GET/POST, graphie « e-mail », cibles tactiles, retours de copie. Migration 0020 appliquée à la base de dev. e2e interface 21/21.
