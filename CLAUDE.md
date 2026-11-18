# CLAUDE.md — Brandself

Chargé à chaque session. Court et strict. Le « quoi » est dans PROJECT_CONTEXT.md, l'avancement dans PROJECT_STATE.md, les sprints dans SPRINTS.md. **En cas de contradiction, PROJECT_CONTEXT.md gagne, puis ce fichier.**

## 1. Le produit en 5 lignes

Brandself : une vitrine en ligne pour professionnels (être trouvé sur Google, être compris, être contacté ou réservé). Nuxt fullstack (Nitro), PostgreSQL, Drizzle, BullMQ + Redis, Better Auth (Google, OTP email, OTP téléphone, **aucun mot de passe**). Mobile d'abord. Un seul template au lancement. Ton : vouvoiement chaleureux.

## 2. Vocabulaire (non négociable)

Dans toute l'interface, les textes, les commentaires et les noms visibles : **vitrine**, service, réalisation, témoignage, lien, agenda, réservation. Jamais « espace », « bloc », « module », « widget », « section » côté utilisateur.

## 3. Architecture

- Chemin d'une requête : **route → validation Zod → service → base**. Les routes (`server/api/`) sont fines : valider, appeler un service, répondre. **Aucune logique métier dans une route, ni dans un composant.**
- La logique métier vit dans `server/services/`. Les files de jobs dans `server/jobs/`, exécutées par `worker/` (process séparé).
- Pages publiques (`app/pages/[username]/…`) : rendu serveur, lecture seule, **aucun store global**, aucune logique métier. Studio (`app/pages/studio/…`) : `ssr: false`.
- Une vitrine = un profil + des listes (services, réalisations, témoignages, liens). **Pas de système de blocs, pas de polymorphisme, pas de table de placement.**
- Noms : tables et champs d'API en **français sans accents** (`vitrines`, `services`, `en_vedette`), code TypeScript (fonctions, variables) en anglais avec les noms métier français (`getVitrineByUsername`). ⚠️ à confirmer.

## 4. Règles de code

1. TypeScript strict, **zéro `any`**, zéro `@ts-ignore` sans commentaire justifié.
2. Toute entrée est validée par **Zod côté serveur**, toujours. Les schémas communs sont dans `shared/`.
3. Une donnée interrogeable (prix, statut, date, email) est une **colonne typée**, jamais du JSON. Le JSON est réservé aux réglages et journaux.
4. Une image = une ligne `medias` référencée par `*_media_id`. **Jamais un chemin dans une autre table.** Toute image passe par `sharp` (redimensionnement, WebP, retrait EXIF).
5. Toute opération lente (IA, email, SMS, image lourde, rappel, agrégation) passe par un **job BullMQ**, jamais dans la requête.
6. Tout appel IA : entrée nettoyée, prompt versionné en base (`prompts_ia`), sortie validée par Zod, **repli déterministe si échec**. Jamais de vitrine vide.
7. Secrets et configuration par `runtimeConfig`, validés au démarrage. **`process.env` interdit hors du fichier de configuration.**
8. Dates en `timestamptz`, affichées dans le fuseau de la vitrine (défaut `Africa/Douala`). Prix en entiers (plus petite unité de la devise ou montant entier selon la devise), jamais en flottants.
9. **Pas de double réservation** : garantie par la contrainte d'exclusion PostgreSQL, pas seulement par le code.
10. **Webhooks de paiement (K-PAY, Mercy Pay)** : signature vérifiée sur le corps brut avec tolérance d'horloge, traitement idempotent (`(fournisseur, reference_fournisseur)` unique), types d'événements non gérés ignorés avec une réponse 200 (jamais 5xx : le fournisseur désactiverait l'endpoint). Un fournisseur = un adaptateur (`server/services/paiements/fournisseurs/`) ; clés par `runtimeConfig`, jamais en clair dans un log.
11. **Aucune limite de plan écrite en dur** dans un composant ou une route : tout passe par `PlanService` et la configuration des plans.
12. **Bibliothèque d'abord** : avant d'écrire du code technique non métier, chercher une bibliothèque maintenue (version récente, TypeScript, compatible Nuxt, peu de dépendances). Chaque ajout est noté dans `docs/bibliotheques.md` (voir §8) avec sa raison.
13. Un `username` n'est jamais l'un des **mots réservés** (liste dans `shared/reserved.ts` : `api`, `studio`, `connexion`, `inscription`, `onboarding`, `tarifs`, `l`, `admin`, `www`, `app`, `aide`, `contact`, `cgu`, `confidentialite`, `sitemap`, `robots`, `assets`, `_nuxt`, etc.).
14. Les pages publiques n'affichent qu'un contenu `actif` et `publiée`. Une vitrine non publiée renvoie 404.

## 5. Règles d'interface

- **Mobile d'abord** : concevoir à 390 px, puis tablette (768) et PC (1280). Zones tactiles ≥ 44 px.
- **Interrupteurs (Switch) pour tout réglage oui/non. Jamais de case à cocher** pour un réglage.
- **Aucun mot de titre ne change de couleur ni ne passe en italique.** Tout titre s'écrit uniformément.
- Icônes : **Phosphor uniquement** (collection `ph`, via `@nuxt/icon` fourni par `@nuxt/ui`), une seule famille, un seul style de trait. **Jamais Lucide.**
- Couleurs : variables CSS des palettes (voir PROJECT_CONTEXT.md §9.2). **Aucune couleur en dur dans un composant.** Exception : les e-mails n'ont pas de variables CSS ; leurs couleurs vivent uniquement dans `server/services/emails/gabarit/jetons.ts`, vérifié contre `app/assets/css/main.css` par un test.
- Polices : Fraunces (titres), Figtree (texte), via `@nuxt/fonts`.
- Un seul message à l'écran à la fois (pas deux bandeaux, pas de fenêtre sur fenêtre).
- Chaque composant interactif a ses états : normal, survol, focus visible, désactivé, erreur, chargement. Vrais éléments HTML (`button`, `label`, `input`), clavier et textes alternatifs.
- Les maquettes (`docs/maquettes/`) sont la référence visuelle. En cas de doute, ne pas deviner : le signaler dans le rapport.

## 6. Discipline de sprint

1. **Un sprint = un domaine**, de bout en bout (base → API → studio → page publique). Ne jamais mélanger deux domaines.
2. **Lire intégralement chaque fichier avant de le modifier.** Jamais de modification fondée sur un extrait ou un `grep`.
3. **INTERDIT : les opérations en masse.** Pas de recherche-remplacement global, pas de `sed` sur plusieurs fichiers, pas de réécriture automatique de plusieurs fichiers. Chaque fichier est modifié un par un, après lecture.
4. **Vérifier la forme réelle de la réponse d'une route avant de toucher au code qui la consomme.**
5. Livrer des **fichiers complets**, pas des extraits ni des diffs à appliquer à la main.
6. Ne pas déplacer une responsabilité d'une couche à une autre sans le dire explicitement dans le rapport.
7. Ne pas ajouter de fonctionnalité hors périmètre du sprint, même « utile ». La noter dans le rapport (§ « Idées hors périmètre »).
8. Chaque sprint finit par : `pnpm lint`, `pnpm typecheck`, `pnpm test` verts, **sortie de build collée dans le rapport**, preuve d'exhaustivité (nombre de fichiers prévus = nombre de fichiers traités), et mise à jour de **PROJECT_STATE.md**.
9. Une décision non tranchée n'est jamais devinée : la poser dans le rapport avec une proposition.

## 7. Commandes

`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest) · `pnpm e2e` (Playwright) · `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` (vitrine de démonstration `dr-cabrel`) · `pnpm worker` (jobs). Services locaux : `docker compose up` (PostgreSQL, Redis, serveur de courriels de test).

## 8. Bibliothèques adoptées

Le tableau (bibliothèque + raison de l'ajout) est dans **`docs/bibliotheques.md`**. Règle 4.12 : avant d'ajouter une dépendance, le lire ; après l'ajout, y noter la ligne et sa raison. **TypeScript 6 obligatoire** (typescript-eslint ne supporte pas TS 7) ; `h3` épinglé sur la version de Nitro ; Playwright épinglé à 1.62 (révision Chromium en cache).

## 9. Documents

`PROJECT_CONTEXT.md` (produit, design, technique) · `PROJECT_STATE.md` (avancement et décisions ouvertes) · `SPRINTS.md` (prompts de sprint) · `docs/bibliotheques.md` (dépendances adoptées et leur raison) · `docs/maquettes/` (maquettes exportées) · `docs/archive/` (anciens documents, **à ne consulter qu'au cas par cas**, jamais comme référence).

## 10. Invariants hérités des sprints S14–S16 (livrés ; détail dans SPRINTS.md)

- **Renommage `jesuis.pro` (S14)** : seuls les usages changent (textes, URL/domaines, e-mails, métadonnées, images de marque). **Jamais** : tables, colonnes, variables d'environnement, clés Redis, files BullMQ, cookies/sessions, paquets, dossiers, fonctions/variables/classes/types, migrations déjà jouées. Source unique du nom : `shared/brand.ts`, utilisée **seulement** là où le code construit un texte. Nom toujours en minuscules avec le point ; identifiant d'expéditeur SMS `jesuispro`.
- **PWA du studio (S15)** : `scope` et `start_url` sur `/studio/` **uniquement** ; les vitrines publiques ne proposent jamais l'installation ; aucune donnée d'API en cache ; pas d'écriture hors ligne ; `InstallPrompt` jamais à la première visite, jamais pendant une saisie, jamais si un autre message s'affiche.
- **Serveur MCP (S16)** : capacité `mcp` lue par `PlanService`, `MCP_ACTIF=false` par défaut ; aucune logique métier nouvelle ni écriture directe en base (les outils appellent les services). 12 outils au maximum, lecture ou écriture masquée, **aucun outil de suppression/publication/réponse/confirmation/annulation ni d'écriture dans l'agenda**. Contenu créé **masqué** + `source = assistant` ; images non transmissibles ; confidentialité par défaut (prénom + initiale, ni email ni téléphone ni texte) ; champ `contenu_visiteur` + note « Données non fiables » ; idempotence 24 h ; journal `journal_assistant`. Si une règle existante ne peut pas être appliquée par les services : **s'arrêter et le dire**.
