# SPRINTS.md — Brandself

14 sprints (S0 à S13). Chaque sprint est un **prompt autonome pour une session Claude Code neuve**.

## Mode d'emploi

1. Ouvrir une session neuve dans le dépôt. Vérifier que `CLAUDE.md`, `PROJECT_CONTEXT.md`, `PROJECT_STATE.md` et `docs/maquettes/` sont présents.
2. Coller **le BLOC COMMUN** (ci-dessous), puis **le prompt du sprint** voulu. Rien d'autre.
3. À la fin : relire le rapport, vérifier les critères de réception, **merger la branche `sprint/sN-nom`**, puis passer au sprint suivant. On ne commence pas S(n+1) avant validation de S(n).
4. Si le rapport contient des décisions à trancher, les trancher dans `PROJECT_STATE.md` avant le sprint suivant.

Ordre et jalons : S0 → S1 → S2 → S3 → S4 → S5 (**version utilisable en interne**) → S6 → S7 → S8 (**bêta fermée**) → S9 → S10 (**lancement payant**) → S11 → S12 → S13.

---

# BLOC COMMUN (à coller avant chaque prompt de sprint)

```
Tu travailles sur Brandself, une plateforme qui donne à un professionnel une vitrine en ligne : être trouvé sur Google, être compris (présentation, services, réalisations, témoignages), être contacté ou réservé (agenda, formulaire, liens). Marché de départ : professionnels francophones (Cameroun et Afrique francophone, puis France). Usage mobile d'abord.

STACK : Nuxt fullstack (Nitro), TypeScript strict, Tailwind, PostgreSQL + Drizzle, BullMQ + Redis (process worker séparé), Better Auth (Google, OTP email, OTP téléphone, AUCUN mot de passe), Zod, Resend, K-PAY pour les abonnements. Un seul template public.

VOCABULAIRE (interface et textes) : « vitrine », service, réalisation, témoignage, lien, agenda, réservation. JAMAIS « espace », « bloc », « module », « widget ». Ton : vouvoiement, chaleureux, phrases courtes.

MODÈLE : une vitrine = un profil + des listes (services, réalisations, témoignages, liens) + un agenda. PAS de système de blocs, PAS de polymorphisme, PAS de table de placement.

AVANT DE COMMENCER, LIS INTÉGRALEMENT : CLAUDE.md, PROJECT_CONTEXT.md, PROJECT_STATE.md, et les maquettes citées par le sprint dans docs/maquettes/. Si une maquette est absente ou illisible, arrête-toi et dis-le : ne devine pas le design.

RÈGLES NON NÉGOCIABLES (rappel de CLAUDE.md) :
- Chemin d'une requête : route → validation Zod → service → base. Aucune logique métier dans une route ni dans un composant.
- Donnée interrogeable = colonne typée, jamais du JSON. Image = ligne `medias`, jamais un chemin.
- Opération lente (IA, email, SMS, image lourde, rappel) = job BullMQ.
- Interrupteurs (Switch) pour tout réglage oui/non, JAMAIS de cases à cocher. Aucun mot de titre en couleur ni en italique. Icônes Phosphor uniquement, JAMAIS Lucide. Aucune couleur en dur : variables CSS des palettes.
- Bibliothèque d'abord : ne recode pas ce qu'une bibliothèque maintenue fait déjà ; note chaque ajout dans CLAUDE.md §8 avec la raison.
- Zéro `any`. Secrets via runtimeConfig. Pas de limite de plan en dur : tout passe par PlanService.

DISCIPLINE (À RESPECTER À LA LETTRE) :
- UN sprint = UN domaine. N'ajoute rien hors périmètre ; note les idées dans le rapport.
- LIS ENTIÈREMENT chaque fichier avant de le modifier. Jamais d'extrait ni de grep comme substitut de lecture.
- INTERDIT : opérations en masse. Pas de recherche-remplacement global, pas de sed sur plusieurs fichiers, pas de réécriture automatique de plusieurs fichiers. Un fichier à la fois, après lecture intégrale.
- Avant de modifier du code qui consomme une route, VÉRIFIE la forme réelle de la réponse de cette route.
- Livre des fichiers COMPLETS.
- Ne déplace aucune responsabilité d'une couche à une autre sans le dire dans le rapport.
- Une décision non tranchée n'est JAMAIS devinée : pose-la dans le rapport avec une proposition. Si elle bloque le sprint, arrête-toi et demande.
- RAPPEL : pas d'opération en masse, pas de remplacement global, un fichier à la fois.

TRAVAIL : crée la branche `sprint/sN-nom`. Procède par étapes courtes, en vérifiant chaque étape (typecheck, tests) avant la suivante.

RAPPORT FINAL OBLIGATOIRE (dans l'ordre) :
1. Résumé en 5 lignes.
2. Liste exhaustive des fichiers créés et modifiés, avec le décompte « prévus = traités ».
3. Migrations (noms, tables et colonnes).
4. Routes ajoutées ou modifiées (méthode, chemin, corps attendu, forme de la réponse).
5. Écrans réalisés, avec les maquettes respectées et tout écart justifié.
6. SORTIE COLLÉE de `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (et `pnpm e2e` si applicable).
7. Critères de réception du sprint, un par un : ✅ ou ❌ avec la preuve.
8. Décisions prises par défaut et décisions à trancher.
9. Idées hors périmètre.
10. Dette connue.
11. Le texte exact à mettre à jour dans PROJECT_STATE.md (tableau d'avancement, décisions, dette, historique) : applique-le.
```

---

# S0 — Fondations

**Objectif** : un projet Nuxt fullstack qui démarre, avec base de données, Redis, worker, tests et structure, sans aucune fonctionnalité métier.
**Pré-requis** : aucun. **Maquettes** : aucune.

**Périmètre**
- Initialiser Nuxt (dernière version stable ; noter la version), TypeScript strict, Tailwind, ESLint, `vue-tsc`, gestionnaire `pnpm`, `.gitignore`, `.env.example`, `README.md` (installation locale en 5 commandes).
- `docker-compose.yml` : PostgreSQL, Redis, un serveur de courriels de test (type Mailpit).
- Drizzle : configuration, dossier de migrations, **première migration** qui active l'extension `btree_gist` ; scripts `db:generate`, `db:migrate`, `db:seed` (seed vide pour l'instant).
- Configuration : `runtimeConfig` validé par Zod au démarrage (échec explicite si une variable manque). `process.env` interdit hors de ce fichier.
- Redis + BullMQ : connexion partagée, une file `systeme` avec un job `ping`, process `worker/` séparé (`pnpm worker`), fichier PM2 `ecosystem.config.cjs` (app + worker).
- Structure des dossiers : `app/`, `server/api`, `server/services`, `server/db`, `server/jobs`, `worker/`, `shared/` (types, schémas Zod, `reserved.ts` avec la liste des mots réservés), `docs/maquettes/`, `docs/archive/`, `tests/`.
- Route `GET /api/health` : vérifie base et Redis, renvoie `{ statut: "ok", base: true, redis: true, version }`.
- Vitest (un test sur le schéma de configuration) et Playwright (un test : la page d'accueil répond).
- CI minimale (GitHub Actions) : lint, typecheck, tests.
- Copier `CLAUDE.md`, `PROJECT_CONTEXT.md`, `PROJECT_STATE.md`, `SPRINTS.md` à la racine ou dans `docs/` comme prévu.

**Hors périmètre** : toute table métier, tout écran, l'authentification, le design.

**Règles spécifiques**
- Décision ouverte #9 (langue des identifiants) : appliquer la valeur par défaut de PROJECT_STATE.md et le noter.
- Ne rien installer « au cas où » : chaque dépendance a une raison notée dans CLAUDE.md §8.

**Critères de réception**
- `docker compose up` puis `pnpm dev` : l'application démarre.
- `pnpm db:migrate` passe sur une base vide ; `btree_gist` est actif.
- `GET /api/health` renvoie ok pour la base et Redis ; arrêter Redis le fait passer en erreur lisible.
- `pnpm worker` démarre et traite un job `ping` (preuve dans le rapport).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm build` verts.
- Une variable d'environnement manquante fait échouer le démarrage avec un message clair.

---

# S1 — Authentification (OTP et Google)

**Objectif** : se connecter ou s'inscrire sans mot de passe, par Google, par email ou par téléphone, avec un code à 6 chiffres.
**Pré-requis** : S0. **Maquettes** : `Connexion-Email`, `Connexion-Telephone`, `Connexion-Code`, `Connexion-Code-Erreur`, `Connexion-PC`.

**Périmètre**
- **Better Auth** avec adaptateur Drizzle (tables d'authentification gérées par la bibliothèque, migrées via Drizzle). Plugins pour OTP email et OTP téléphone : **vérifie dans la documentation de la version installée que ces plugins existent et comment les configurer ; si une exigence ci-dessous n'est pas couverte, dis-le dans le rapport avant d'écrire du code maison.**
- Table `users` applicative (ou extension de la table de la bibliothèque) : `email?`, `telephone?`, `nom`, `locale`, `devise`, `fuseau`, `email_hebdo` (booléen, défaut vrai), `created_at`. Un utilisateur peut avoir un email, un téléphone ou les deux.
- Google : connexion sociale (identifiants en configuration ; en développement sans identifiants, le bouton est présent mais désactivé avec un message, sans planter).
- **OTP** : 6 chiffres, valable 10 minutes, **3 essais par code** (au-delà, le code est invalidé), renvoi possible après 60 secondes, limite de débit par IP et par identifiant (email ou numéro). Réponses qui ne révèlent pas si un compte existe.
- Interface `OtpSender` : implémentation **email** (Resend en production, serveur de courriels de test en développement), implémentation **SMS** (fournisseur à brancher : en développement, le code s'écrit dans la console du serveur), et un emplacement `whatsapp` non implémenté. Les envois passent par un job BullMQ.
- Session : cookie httpOnly, sécurisé, durée 30 jours. Page des appareils connectés plus tard (S2, écran Compte).
- Un utilisateur sans vitrine, une fois connecté, est redirigé vers `/onboarding` (page provisoire en S1 : « Bienvenue », créée pleinement en S2/S8). Avec une vitrine, vers `/studio`.
- Pages : `/connexion` (onglets Email / Téléphone, bouton Google, séparateur « ou », mentions légales), `/connexion/code` (6 cases, `autocomplete="one-time-code"`, décompte du renvoi, état d'erreur « Il vous reste 2 essais », lien « Modifier mon email / numéro »). Version PC : panneau chaleureux à gauche, formulaire à droite.
- Middleware : `/studio/**` exige une session ; `/connexion` redirige si déjà connecté. `GET /api/studio/moi` renvoie l'utilisateur.
- **Route `@username`** : créer `app/pages/@[username].vue` avec un contenu provisoire et **vérifier qu'elle se résout correctement à côté de `[username]`**. Si le routage pose problème, implémenter le repli `/l/[username]` et le noter.
- Mots réservés : `shared/reserved.ts` (voir CLAUDE.md §4.13) et utilitaire de validation de `username`.
- Fuseau et devise par défaut à la création : `Africa/Douala` et `XAF` ; modifiables plus tard.

**Hors périmètre** : design complet des pages internes, vitrine, onboarding guidé, WhatsApp.

**Règles spécifiques** : aucun champ « mot de passe » nulle part. Textes en vouvoiement. Le design utilise des composants provisoires propres : le système de design complet arrive en S2, donc isoler les styles pour pouvoir les remplacer.

**Critères de réception**
- Connexion par email OTP, par téléphone OTP (code lu dans la console) et par Google (si identifiants fournis) : session créée, persistante au rechargement.
- Mauvais code ×3 : code invalidé, message correct. Code expiré : message correct. Renvoi avant 60 s refusé. Dépassement de débit : réponse 429 lisible.
- Un compte inexistant est créé à la première connexion ; un compte existant se reconnecte sans doublon (même email, même numéro).
- `/studio` redirige vers `/connexion` sans session. Déconnexion fonctionnelle.
- `@username` ou `/l/username` répond (contenu provisoire) sans conflit avec `[username]`.

**Tests** : unitaires (génération, expiration, essais, renvoi, limites de débit), e2e (parcours email avec le serveur de courriels de test), un test de non-divulgation de l'existence d'un compte.

---

# S2 — Studio (coque), Profil et accueil public

**Objectif** : un utilisateur connecté crée sa vitrine, édite son profil, la publie, et la voit en ligne sur mobile, tablette et PC. Mise en place du **système de design**.
**Pré-requis** : S1. **Maquettes** : `Studio`, `Studio-Profil`, `Studio-Compte`, `Main` (accueil mobile), `Vitrine-Sauge`, `Vitrine-Tablette`, `Vitrine-PC`, `Inscription-4` (palette), `Inscription-Fin`.

**Périmètre**
- **Décision #10 au début du sprint** : `@nuxt/ui` comme base ou composants maison ; noter le choix et la raison.
- **Système de design** : variables CSS des 5 palettes (Terracotta, Sauge, Indigo, Ocre, Bordeaux) appliquées par attribut sur la racine ; Tailwind branché sur ces variables ; polices Fraunces et Figtree (`@nuxt/fonts`) ; icônes Phosphor (`@nuxt/icon`). Composants : `Button` (principal, contour, lien), `Field`, `Select`, `Textarea`, **`Switch`**, `Segmented`, `RadioCard`, `Chip`, `Card`, `Avatar`, `BottomNav` / `TopNav`, `EmptyState`, `PaletteChoice`. Chaque composant a ses états (survol, focus visible, désactivé, erreur, chargement).
- **Base** : tables `vitrines` (voir PROJECT_CONTEXT.md §11) et `medias`. Contrainte : un `username` unique, validé par les mots réservés, minuscules, chiffres et tirets, 3 à 30 caractères.
- **Médias** : couche de stockage (unstorage, disque local, colonne `disk`) ; `POST /api/studio/medias` (multipart ; vérification du type par octets magiques ; types JPEG, PNG, WebP ; taille max 10 Mo ; `sharp` : orientation, retrait EXIF, WebP, variantes de tailles) ; `DELETE /api/studio/medias/:id` ; service de fichiers avec en-têtes de cache longs.
- **API studio** : `POST /api/studio/vitrine` (création provisoire : titre, prénom, nom, métier, username), `GET` et `PUT /api/studio/vitrine` (mise à jour partielle validée), `GET /api/studio/username-disponible`, `POST /api/studio/vitrine/publier` et `/depublier`, `PUT /api/studio/moi` (langue, devise, fuseau), `GET /api/studio/appareils` et suppression d'une session.
- **API publique** : `GET /api/public/:username` (profil si publié, sinon 404).
- **Studio** (`ssr: false`) : mise en page avec **5 entrées** (barre du bas sur mobile, barre du haut sur ordinateur) : Vitrine, Services, Réalisations, Liens, Agenda ; avatar en haut à droite ouvrant le Compte. Les entrées dont le sprint n'est pas fait affichent un état vide chaleureux. Écran **Vitrine** : statut, ligne de statistiques (valeurs provisoires à zéro), « prochaine étape » (une seule, règle simple : photo manquante → « Ajoutez votre photo »), liste des sections avec compteurs. Écran **Profil** conforme à la maquette : photo, titre (liste), prénom, nom avec aperçu « Affiché sur la vitrine », métier, ville, pays (liste), accroche avec compteur, présentation, contact, palette, adresse avec copie. L'enregistrement est explicite. Écran **Compte** : infos, langue, devise, fuseau, appareils connectés, déconnexion, suppression du compte (confirmation), carte d'abonnement **provisoire** (« Plan gratuit »).
- **Onboarding provisoire** (`/onboarding`) : formulaire court (titre, prénom, nom, métier, username) qui crée la vitrine puis ouvre le studio. Il sera remplacé en S8.
- **Accueil public** `/[username]` : rendu serveur, 3 mises en page (mobile, tablette, PC) conformes aux maquettes : barre du haut, section de présentation (mobile : photo pleine largeur en haut avec pastille de disponibilité ; tablette et PC : titre, accroche, boutons, photo en arche avec contour décalé et carte « Prochain créneau »), présentation, bloc contact, pied de page avec « Créé avec Brandself ». **Les sections services, réalisations, témoignages et agenda n'apparaissent pas encore** (leurs sprints). Palette appliquée selon le choix de l'utilisateur. 404 si la vitrine n'est pas publiée. Balises de base (titre `Nom — Métier à Ville`, description).
- **Seed** : vitrine de démonstration `dr-cabrel` (données de PROJECT_CONTEXT.md §15).

**Hors périmètre** : services, réalisations, témoignages, liens, agenda, IA, statistiques réelles, abonnement.

**Règles spécifiques**
- Pas d'italique ni de couleur sur un mot de titre. Photo en arche, `object-position: center top`.
- Les pages publiques n'importent aucun store ; elles reçoivent leurs données par `useAsyncData` sur les routes publiques.
- L'adresse (username) ne se modifie qu'avec un avertissement (le lien partagé cessera de fonctionner).

**Critères de réception**
- Parcours e2e : connexion → création de la vitrine → modification du profil avec photo → publication → l'accueil public s'affiche à 390, 768 et 1280 px ; dépublication → 404.
- Les 5 palettes s'appliquent sans changer un seul composant (changer l'attribut suffit).
- Le Switch est un vrai contrôle accessible (clavier, rôle, étiquette). Aucune couleur en dur dans `app/`.
- Une photo de 8 Mo en EXIF tourné ressort redimensionnée, en WebP, sans EXIF. Un fichier `.exe` renommé en `.jpg` est refusé.
- Le contraste du texte sur chaque palette respecte 4,5:1 (test automatisé sur les variables).

**Tests** : validation du username, mots réservés, upload (types, taille, octets magiques), publication, composants du système de design (Vitest + rendu), e2e du parcours.

---

# S3 — Services

**Objectif** : créer, gérer et afficher les services (types, tarifs, photos, mise en vedette), avec cartes soignées et pages de détail.
**Pré-requis** : S2. **Maquettes** : `Studio-Services`, `Studio-Service`, `Main` / `Vitrine-Tablette` / `Vitrine-PC` (section services), `Services-PC`, `Service-Detail-Mobile`, `Service-Detail-PC`.

**Périmètre**
- **Base** : table `services` (PROJECT_CONTEXT.md §11). Slug unique par vitrine, généré depuis le titre, stable ensuite. Colonne `paiement_instructions`.
- **API studio** : `GET` et `POST /api/studio/services`, `GET`, `PUT`, `DELETE /api/studio/services/:id`, `PATCH …/visibilite`, `PATCH …/vedette`, `POST /api/studio/services/reordonner`.
- **Règles serveur** : 3 services en vedette au maximum (la 4e demande est refusée avec un message qui dit lequel retirer) ; à la création, les 3 premiers services sont en vedette par défaut ; champs obligatoires selon le type (accompagnement : nombre de séances et durée ; rendez-vous : durée ; atelier : durée ; devis : aucun prix) ; tarif payant : prix et devise obligatoires ; `paiement_mode` : **en v1 seules les valeurs « sur place » et instructions de règlement sont proposées dans le studio** ; les valeurs « en ligne » et « au choix » existent en base et dans le code mais sont masquées par le drapeau `PAIEMENT_EN_LIGNE=false`.
- **Studio** : écran **Liste** (miniature, titre, « type · durée · tarif », étiquette En vedette, interrupteur de visibilité, éléments masqués grisés, compteur « 5 visibles · 3 en vedette sur 3 », bouton Ajouter, barre du bas avec Services actif) ; écran **Formulaire** (photo facultative, titre, description, type, bloc « Accompagnement » conditionnel, tarif en 3 choix, prix et devise, mode de règlement, trois interrupteurs : Visible, Réservable en ligne, En vedette ; Enregistrer ; Supprimer avec confirmation). Réordonnancement par glisser-déposer (bibliothèque).
- **API publique** : `GET /api/public/:username/services` et `GET /api/public/:username/services/:slug` (seulement les services actifs d'une vitrine publiée).
- **Pages publiques** :
  - **Accueil** : section « Services à la une » avec les cartes (voir PROJECT_CONTEXT.md §5) : mobile et tablette en défilement horizontal avec la carte suivante visible, PC en 3 colonnes, bouton « Voir tous les services (n) ».
  - **`/[username]/services`** : grille de toutes les cartes ; visible seulement s'il y a au moins un service ; sinon 404.
  - **`/[username]/services/[slug]`** : détail (mobile et PC) : photo large, pastille du type, titre, durée, tarif, mode de règlement, description, « Ce que comprend… » (liste libre facultative : ajouter un champ `inclus` en lignes séparées dans le formulaire), autres services. Bouton adapté au type : *Réserver*, *Réserver la 1re séance*, *S'inscrire*, *Demander un devis* (les actions de réservation et de demande sont **branchées en S7** : en S3 le bouton mène à `/[username]/reserver` ou au contact selon le cas, page provisoire).
  - Carte sans photo : aplat de la couleur d'accent avec l'initiale du titre.
- **SEO** : titre et description par service, données structurées `Service`.
- **Seed** : les 6 services de démonstration (3 avec photo de démonstration, 3 sans).

**Hors périmètre** : créneaux, réservations, demandes, paiement en ligne, limites du plan gratuit.

**Règles spécifiques** : les cartes sont un seul composant utilisé à l'accueil et sur la page Services. Les libellés de bouton viennent d'une table de correspondance unique (type → libellé).

**Critères de réception**
- Créer un service de chaque type avec validations correctes ; le formulaire n'affiche que les champs pertinents.
- 4e service en vedette refusé ; retirer l'un permet d'en ajouter un autre ; masquer un service le retire de l'accueil, de `/services` et du détail (404).
- Une vitrine sans service n'a pas de page `/services` (404) ni de section sur l'accueil.
- Cartes conformes aux maquettes à 390, 768 et 1280 px ; défilement horizontal fonctionnel au doigt et au clavier.
- Les prix s'affichent avec la bonne devise ; « Gratuit » et « Sur devis » correctement rendus.

**Tests** : règles de vedette, validations par type, slug unique, visibilité publique, e2e (création → affichage sur l'accueil → page de détail).

---

# S4 — Réalisations

**Objectif** : gérer et afficher les réalisations (image principale, galerie, faits).
**Pré-requis** : S3. **Maquettes** : `Studio-Realisations`, `Studio-Realisation`, `Realisation-Detail-Mobile`, accueil (section « À la une »).

**Périmètre**
- **Base** : tables `realisations` et `realisation_images` (PROJECT_CONTEXT.md §11).
- **API studio** : CRUD, `visibilite`, `vedette`, `reordonner`, ajout et suppression d'images de galerie (utilise `medias`).
- **Règles** : 3 en vedette au maximum, 3 premières en vedette par défaut ; image principale obligatoire ; galerie facultative (6 images max ⚠️).
- **Studio** : liste (miniature, titre, « année · lieu », étiquette, interrupteur) et formulaire (image principale, galerie avec ajout `+`, titre, description, année, lieu ou client, rôle, lien externe, interrupteurs Visible et En vedette).
- **Public** : accueil (une réalisation à la une en grand + « Voir toutes les réalisations (n) », dans la section « À la une » partagée avec le témoignage ; **la section est construite de façon à accueillir le témoignage en S5**), `/[username]/realisations` (liste), `/[username]/realisations/[slug]` (détail : image, faits année/lieu/rôle, description, galerie en grille 2×2, bouton « Voir le projet » si lien, autres réalisations, bandeau « Un projet en tête ? Parlons-en. » avec bouton de réservation).
- SEO : titre, description, données structurées simples.
- Seed : 3 réalisations de démonstration.

**Hors périmètre** : témoignages, catégories ou tags, vidéo.

**Critères de réception** : mêmes principes que S3 (vedette, visibilité, 404 si vide) ; galerie ajoutable, supprimable, ordonnable ; détail conforme à la maquette mobile ; lien externe ouvert avec `rel="noopener"`.

**Tests** : vedette, visibilité, galerie, e2e de création → affichage → détail.

---

# S5 — Témoignages

**Objectif** : afficher la preuve sociale sur l'accueil et la gérer depuis le studio.
**Pré-requis** : S4. **Maquettes** : `Studio` (ligne Témoignages), accueil (bloc témoignage), `Studio-Realisation` pour le style de formulaire.

**Périmètre**
- **Base** : table `temoignages`. **API studio** : CRUD, `visibilite`, `vedette`, `reordonner`. **Règles** : 3 en vedette max, 3 premiers par défaut.
- **Studio** : depuis l'écran Vitrine, la ligne « Témoignages » ouvre une liste (même modèle que les autres) et un formulaire (auteur, fonction facultative, texte, interrupteurs Visible et En vedette).
- **Public** : sur l'accueil, citation en grand (serif, italique permis pour la citation), auteur et fonction, et « Lire d'autres avis (n) » qui **déplie les autres témoignages sur place** (décision #14, pas de nouvelle page). Pas de témoignage visible : le bloc disparaît.
- Seed : 3 témoignages marqués comme **espaces réservés** (« [Témoignage d'un patient] ») tant que Cabrel n'en fournit pas de vrais ; ne jamais en inventer de plausibles.
- **Mise à jour de PROJECT_STATE.md** : jalon « première version utilisable en interne » atteint si tous les critères sont verts.

**Critères de réception** : parcours complet connexion → création de la vitrine → profil → un service → une réalisation → un témoignage → vitrine publiée, **sans toucher à l'API à la main**. Dépliage accessible au clavier.

**Tests** : e2e du parcours complet ci-dessus (c'est le test de non-régression principal du projet).

---

# S6 — Liens et link-in-bio

**Objectif** : gérer ses liens et partager une page link-in-bio.
**Pré-requis** : S5. **Maquettes** : `Link-in-bio`, `Studio-Liens`, `Studio-Lien`.

**Périmètre**
- **Base** : table `liens` (types : libre, whatsapp, reseau, email, telephone, vitrine).
- **API studio** : CRUD, `visibilite`, `reordonner`. Validation par type : whatsapp → numéro, le lien `https://wa.me/…` est **construit par le serveur** ; réseau → plateforme (liste) + URL ; email, téléphone → formats ; vitrine → page interne (accueil, services, réserver…). Seules les URL `https` ou les schémas autorisés sont acceptés (jamais `javascript:`).
- **Studio Liens** : carte de la page de liens (`brandself.io/@username`, copie, boutons Partager (API de partage du navigateur avec repli) et QR code (bibliothèque `qrcode`, affiché et téléchargeable), nombre de clics de la semaine) ; liste réordonnable par glisser-déposer avec poignée, interrupteurs, clics par lien ; formulaire d'ajout avec **aperçu du bouton tel qu'il apparaît**.
- **Public `/@username`** (ou `/l/username`) : mobile d'abord, photo en arche, nom, accroche, boutons de liens, bouton réserver, mention « Créé avec Brandself ». Seuls les liens actifs.
- **Clics** : `POST /api/public/:username/liens/:id/clic` (incrémente `clics`, limité en débit, ne bloque jamais la navigation).
- **Accueil** : les liens de type réseau s'affichent en icônes dans le pied de page.
- Seed : 4 liens de démonstration.

**Critères de réception** : QR code lisible renvoyant à la bonne adresse ; ordre et masquage reflétés sur la page publique ; lien WhatsApp valide ; un lien `javascript:` refusé ; la page de liens est correcte à 390 px et à 1280 px.

**Tests** : validations par type, ordre, clics, e2e.

---

# S7 — Agenda, réservations et demandes

**Objectif** : permettre à un visiteur de réserver un créneau (ou de faire une demande), et au professionnel de gérer son agenda, sans jamais de double réservation.
**Pré-requis** : S3 (services), S6. **Maquettes** : `Main` / `Vitrine-Tablette` / `Vitrine-PC` (bloc agenda et carte « Prochain créneau »), `Reserver-Mobile`, `Reserver-PC`, `Reserver-Confirmation`, `Service-Detail-*` (créneaux), `Studio` (ligne Agenda).

**Périmètre**
- **Base** : `disponibilites`, `indisponibilites`, `reservations` avec **contrainte d'exclusion** (`btree_gist`) sur `tstzrange(debut, fin)` par vitrine pour les statuts en attente et confirmée ; `demandes` ; colonnes de la vitrine : `fuseau`, `pas_creneau_min` (défaut 30), `preavis_heures` (défaut 2), `horizon_jours` (défaut 60).
- **Service de créneaux** (cœur du sprint, pur et testé) : à partir des disponibilités hebdomadaires, retirer indisponibilités et réservations actives, respecter la durée du service, le pas, le préavis et l'horizon, dans le fuseau de la vitrine. Aucune dépendance HTTP.
- **API publique** : `GET /api/public/:username/creneaux?service=&du=&au=` ; `POST /api/public/:username/reservations` (valide, **crée en une transaction**, répond 409 si le créneau vient d'être pris, limite de débit, champ piège anti-robot) ; `POST /api/public/:username/demandes` (atelier, prestation sur devis).
- **API studio** : `GET/PUT /api/studio/agenda/disponibilites`, `GET/POST/DELETE /api/studio/agenda/indisponibilites`, `GET /api/studio/reservations` (à venir, passées), `PATCH /api/studio/reservations/:id/confirmer` et `/annuler` (avec motif facultatif), `GET /api/studio/demandes`, `PATCH /api/studio/demandes/:id`.
- **Transitions de statut** : en attente → confirmée | annulée ; confirmée → annulée | terminée (automatique après la fin). Toute autre transition est refusée.
- **Emails** (jobs) : au professionnel (nouvelle demande), au visiteur (demande reçue, confirmation, annulation). Vouvoiement, récapitulatif complet, lien d'ajout à l'agenda (fichier ICS joint).
- **Studio Agenda** : réservations à venir et passées avec actions Confirmer / Annuler ; éditeur de disponibilités par jour de la semaine (plusieurs plages) ; indisponibilités ; réglages avancés repliés (pas, préavis, horizon). Les demandes (devis, ateliers) apparaissent dans la même liste avec une étiquette.
- **Public** :
  - **Accueil** : bloc agenda visuel (choix du service, mini-calendrier de la semaine avec points de disponibilité, jours passés grisés, créneaux du jour, bouton « Confirmer … ») et carte « Prochain créneau » du hero, alimentés par le service de créneaux. Sur PC : calendrier à gauche, créneaux à droite. Sans disponibilité : le bloc disparaît.
  - **`/[username]/reserver`** : récapitulatif du rendez-vous (service, date, durée, tarif, lieu), formulaire (nom, email, téléphone ou WhatsApp, motif facultatif, interrupteur « Rappel par email »), choix du règlement (**v1 : « Payer sur place » seul affiché ; l'option « en ligne » est masquée par le drapeau**), mentions, bouton « Envoyer ma demande ». Mobile et PC.
  - **Confirmation** : « Votre demande est envoyée », récapitulatif, ajout à l'agenda, retour à la vitrine.
  - **Détail d'un service** : prochains créneaux et bouton actifs. Atelier et devis : formulaire de demande.
- Seed : disponibilités de démonstration et 2 réservations.
- **Limites du plan gratuit (10 réservations par mois)** : prévues en S10, **ne pas les coder ici**.

**Hors périmètre** : paiement en ligne, rappels 24 h avant (S9), synchronisation avec un calendrier externe, groupes avec capacité.

**Règles spécifiques** : le service de créneaux est la **seule** source de vérité (accueil, détail, réservation). La vérification finale se fait dans la transaction d'écriture, jamais seulement avant. Ne jamais faire confiance à l'heure du navigateur : fuseau de la vitrine.

**Critères de réception**
- **Test de concurrence** : deux `POST` simultanés sur le même créneau → un 201 et un 409 (preuve dans le rapport).
- Un créneau annulé redevient disponible. Un créneau dans le préavis ou au-delà de l'horizon n'est jamais proposé.
- Les créneaux sont corrects pour une vitrine à `Africa/Douala` et pour une vitrine à `Europe/Paris` (test de fuseaux).
- Emails reçus (serveur de courriels de test) avec le bon contenu ; fichier ICS valide.
- L'accueil, la page de détail et `/reserver` montrent les mêmes créneaux au même moment.

**Tests** : unitaires intensifs du service de créneaux (disponibilités, indisponibilités, chevauchements, durée, pas, préavis, horizon, fuseaux), concurrence, transitions, e2e de réservation de bout en bout.

---

# S8 — Inscription guidée et IA

**Objectif** : de la première connexion à la vitrine publiée en moins de 10 minutes, avec une proposition de l'IA.
**Pré-requis** : S7. **Maquettes** : `Inscription-1` à `Inscription-4`, `Inscription-Fin`, `Studio-Profil` (bouton IA).

**Périmètre**
- **Parcours** `/onboarding` en 4 étapes + écran final, remplaçant le formulaire provisoire : (1) titre, prénom, nom, métier avec suggestions, ville, pays ; (2) photo (obligatoire, conseils) ; (3) proposition de l'IA : 3 accroches au choix, présentation modifiable, 3 services proposés avec interrupteurs ; (4) adresse (vérification de disponibilité en direct, délai de 450 ms) et choix de la palette ; (5) « C'est en ligne » avec adresse copiable, Voir ma vitrine, Partager sur WhatsApp, prochaine étape. Barre de progression, retour possible, **progression conservée** si l'utilisateur quitte.
- **Service IA** `server/services/ia/` : interface de fournisseur interchangeable (décision #11), table `prompts_ia` (types `onboarding_vitrine`, `ameliorer_texte`) avec versions actives, table `generations_ia` (trace de chaque appel : type, statut, tokens, durée, entrée, sortie).
- **Garde-fous** : nettoyage de l'entrée (longueur, caractères, détection simple d'injection de prompt), sortie validée par Zod avec limites (accroche 10-15 mots, présentation 80-260 mots…), **ne jamais inventer de faits** (années d'expérience, diplômes, lieux absents de l'entrée), **repli déterministe** si l'IA échoue ou dépasse 25 s (contenu minimal construit depuis les réponses : jamais de vitrine vide), nouvelle tentative avec attente progressive.
- **Génération asynchrone** : `POST /api/studio/onboarding/generer` crée un job (BullMQ) ; `GET /api/studio/generations/:id` (état, progression) interrogé toutes les 2 s par l'écran de l'étape 3 ; message chaleureux pendant l'attente.
- **Amélioration de texte** : `POST /api/studio/ia/ameliorer` ({ champ, texte, objectif }) utilisé par le bouton « Améliorer avec l'IA » du Profil ; l'utilisateur valide avant d'enregistrer (aperçu avant/après).
- **Quota** : 3 générations par mois pour le plan gratuit, via `PlanService` (valeur de configuration ; **application effective en S10**, ici le compteur est tenu et le quota lu sans bloquer).
- `POST /api/studio/onboarding/terminer` : crée les services choisis (les 3 premiers en vedette), applique accroche, présentation et palette, publie.
- Mise à jour de la « prochaine étape » : après l'inscription, « Ouvrez vos disponibilités ».

**Hors périmètre** : import LinkedIn ou CV, assistant conversationnel, génération d'articles.

**Règles spécifiques** : aucun prompt écrit en dur dans le code (tout en base, seedé). L'utilisateur reste maître : rien n'est publié sans son accord à l'étape 4.

**Critères de réception**
- Parcours e2e complet (avec un faux fournisseur d'IA déterministe) en moins de 10 minutes de saisie réaliste.
- Fournisseur d'IA en panne : l'étape 3 propose le contenu de repli et l'inscription aboutit.
- Une entrée contenant « ignore tes instructions… » ne modifie pas le comportement (test).
- Quitter à l'étape 3 et revenir reprend à l'étape 3.
- Le contenu généré respecte les limites de longueur ; aucun fait absent de l'entrée.

**Tests** : garde-fous, repli, validation de sortie, progression conservée, e2e.

---

# S9 — Notifications et rétention

**Objectif** : faire revenir l'utilisateur quand il se passe quelque chose.
**Pré-requis** : S8. **Maquettes** : `Studio` (prochaine étape), `Studio-Compte` (préférences), `Inscription-Fin`.

**Périmètre**
- **Formulaire de contact** de l'accueil : `POST /api/public/:username/messages` (table `messages`, limite de débit, champ piège) ; studio : liste des messages et marquage « lu » (dans l'écran Vitrine).
- **Emails transactionnels** (jobs) : nouveau message de contact au professionnel ; **rappel au visiteur 24 h avant le rendez-vous** (si l'interrupteur a été activé) ; rappel au professionnel le matin d'un jour avec rendez-vous. Modèles en français, vouvoiement.
- **Résumé hebdomadaire** : tâche répétée le lundi à 8 h (fuseau de l'utilisateur) : visites, clics, réservations des 7 jours ; **s'il n'y a eu aucune activité, une seule suggestion concrète** ; lien de désabonnement et interrupteur dans Compte (`email_hebdo`).
- **Prochaine étape unique** : `GET /api/studio/prochaine-etape` selon l'ordre : photo → premier service → disponibilités → première réalisation → partager la vitrine ; une seule à la fois, disparaît quand tout est fait ; ignorée = ne revient pas (mémorisée).
- **Aide au partage** : à la publication et depuis « Partager », message prêt à envoyer (WhatsApp, LinkedIn) avec le lien et le QR code.
- **Règles de fréquence** : un seul message à l'écran à la fois ; au plus un email non transactionnel par semaine ; chaque email a une raison d'être claire.
- Les messages « passage au payant à la limite » sont posés en S10.

**Hors périmètre** : WhatsApp comme canal de notification, notifications dans le navigateur, centre de notifications.

**Critères de réception** : email de contact reçu ; rappel envoyé au bon moment dans le bon fuseau (test avec horloge simulée) ; résumé hebdomadaire correct avec et sans activité ; désabonnement effectif ; une seule « prochaine étape » à l'écran.

**Tests** : planification (horloge simulée), contenu des emails, règle d'un seul email hebdomadaire, prochaine étape.

---

# S10 — Abonnements, plans et K-PAY

**Objectif** : monétiser : plan gratuit limité, plan payant prépayé, renouvellement manuel avec rappels.
**Pré-requis** : S9 ; **décisions #1 (prix) et #13 (accès sandbox K-PAY) tranchées**, sinon s'arrêter après la partie « plans » et le signaler. **Maquettes** : `Studio-Compte`, `Tarifs-PC`.

**Périmètre**
- **Configuration des plans** (`server/config/plans.ts`) : limites (services, réalisations, témoignages : 3 / illimité ; réservations par mois : 10 / illimité ; générations IA par mois : 3 / illimitée ; badge ; statistiques) et **prix par devise et par période** (1, 3, 12 mois). **`PlanService`** unique : lecture du plan réel (payant actif, en grâce, ou gratuit), contrôle des quotas, renvoi d'un message de limite clair.
- **Application des limites** : branchée sur les créations (services, réalisations, témoignages), les réservations du mois (S7), les générations IA (S8). Au moment de la limite, l'API renvoie une erreur structurée que l'interface transforme en **un seul message** expliquant ce qui se débloque, avec bouton vers l'abonnement. **Aucune fenêtre promotionnelle ailleurs.**
- **Masquage à l'expiration** : au-delà des limites du gratuit, les éléments les plus récents sont **masqués côté public** (jamais supprimés) ; ils réapparaissent au renouvellement. La logique est centralisée dans les requêtes publiques.
- **Badge « Créé avec Brandself »** : affiché pour le plan gratuit, retiré pour le payant (toutes les pages publiques).
- **Base** : tables `abonnements` et `paiements`.
- **Client K-PAY** (TypeScript maison, `server/services/kpay/`) : création d'un paiement (Mobile Money ou carte) pour une période et une devise, vérification de la **signature** des webhooks, **idempotence** par `reference_kpay` unique. Routes : `POST /api/studio/abonnement/paiement` ({ periode, devise }) → lien de paiement ; `POST /api/webhooks/kpay` ; `GET /api/studio/abonnement`.
- **Cycle de vie** : le paiement confirmé prolonge `expire_le` (ajoute la période à partir de l'échéance si l'abonnement est encore actif) ; **tâche quotidienne** (BullMQ) : rappels à J-7, J-3 et le jour J avec lien « Renouveler en un clic », passage en **grâce de 7 jours** (bandeau), puis retour au gratuit.
- **Interface** : écran Compte (carte d'abonnement : état, « Actif jusqu'au… », « Il vous reste n jours », choix 1/3/12 mois avec prix, bouton « Renouveler maintenant », mention « ne se renouvelle pas automatiquement ») ; page publique **`/tarifs`** (gratuit vs payant, choix de devise et de période, honnêteté sur le renouvellement manuel).
- Seed : un compte payant actif et un compte en grâce.

**Hors périmètre** : paiement en ligne des réservations, factures PDF (noter en idée), second fournisseur de paiement.

**Règles spécifiques** : aucun prix ni limite en dur dans l'interface. Les montants sont des entiers (XAF sans décimales ; EUR et USD en centimes). Un webhook rejoué ne prolonge jamais deux fois l'abonnement. En cas d'incertitude sur l'API de K-PAY, ne pas inventer : s'arrêter et demander la documentation.

**Critères de réception**
- Un paiement de test (sandbox) active le plan ; le même webhook rejoué ne change rien ; un webhook à signature invalide est rejeté.
- Expiration simulée : rappels aux bonnes dates, grâce de 7 jours, puis retour au gratuit **sans aucune suppression** ; renouvellement : tout réapparaît.
- À la 4e création d'un service en gratuit : un seul message de limite, pas d'erreur technique.
- `/tarifs` et Compte affichent les prix de la devise choisie.

**Tests** : `PlanService` (tous les cas), webhooks (signature, idempotence), planification des rappels (horloge simulée), masquage et réapparition, e2e.

---

# S11 — Statistiques

**Objectif** : montrer à l'utilisateur ce que sa vitrine lui rapporte.
**Pré-requis** : S10. **Maquettes** : `Studio` (ligne de chiffres).

**Périmètre**
- **Collecte** : table `vues` ; `POST /api/public/:username/vue` (envoi discret côté navigateur au chargement d'une page publique, page vue, source, appareil). **Sans cookie** : identifiant visiteur = empreinte de l'IP salée **avec un sel qui change chaque jour**. Robots filtrés. Jamais d'adresse IP brute stockée. Pays déduit des en-têtes si disponibles.
- **Agrégation** : tâche quotidienne qui calcule des totaux par jour ; purge des lignes brutes anciennes (90 jours).
- **API studio** : `GET /api/studio/statistiques?periode=7|30|90` (visites, visiteurs uniques, clics sur les liens, réservations, pages les plus vues, sources) ; les périodes et détails disponibles dépendent du plan via `PlanService` (gratuit : 7 jours, totaux ; payant : 90 jours, pages et sources) ⚠️.
- **Studio** : la ligne de chiffres de l'écran Vitrine (visites, clics, réservations des 7 jours) devient réelle ; un détail s'ouvre à la demande (liste simple, **pas de graphiques en accueil**).
- Les chiffres de démonstration du seed sont remplacés par des données générées.

**Critères de réception** : les chiffres correspondent aux visites réellement effectuées (test e2e : N visites → N comptées, un robot n'est pas compté) ; aucune adresse IP brute en base ; le plan gratuit ne voit pas le détail payant.

**Tests** : empreinte et sel journalier, filtre des robots, agrégation, limites par plan.

---

# S12 — SEO final et performance

**Objectif** : que chaque page publique soit trouvable et rapide, y compris sur mobile avec une connexion limitée.
**Pré-requis** : S11. **Maquettes** : toutes les pages publiques.

**Périmètre**
- **Audit page par page** (accueil, services, détail de service, réalisations, détail, réserver, link-in-bio) : titre (`Nom — Métier à Ville`, détail : `Service — Nom — Ville`), description (générée par l'IA, modifiable dans le profil, repli propre), balise canonique, Open Graph et Twitter, **image de partage générée** par vitrine, données structurées (`Person`/`ProfessionalService`, `Service`) valides, hiérarchie des titres (un seul h1), textes alternatifs, langue de la page.
- `sitemap.xml` (index + une carte par vitrine : seulement les pages visibles) et `robots.txt` ; les vitrines non publiées et les pages vides sont exclues ; pages inexistantes en 404.
- **Performance** : images responsives et paresseuses (`@nuxt/image`), poids des pages, polices optimisées, JavaScript minimal sur les pages publiques ; **cache par page** (stale-while-revalidate) avec **invalidation à chaque modification dans le studio** (publier, modifier, masquer) ; objectifs sur mobile simulé : LCP < 2,5 s, CLS < 0,1 ; mesures avec Lighthouse en CI sur la vitrine de démonstration.
- **Site marketing `/` provisoire** : page simple (promesse, 3 fonctions, tarifs, connexion) en attendant la maquette (décision #15). Ne pas inventer un design complexe.
- Accessibilité : contrastes, navigation clavier, focus visibles, libellés, vérification automatisée (axe) sur les pages clés.

**Critères de réception** : validation des données structurées sans erreur ; sitemap correct ; modification dans le studio visible en ligne en moins de quelques secondes (invalidation du cache) ; budgets de performance respectés dans le rapport Lighthouse (collé) ; aucun problème critique d'accessibilité.

**Tests** : e2e (balises de chaque page), invalidation du cache, sitemap.

---

# S13 — Durcissement et lancement

**Objectif** : mettre en production en confiance.
**Pré-requis** : S12 ; décision #12 tranchée (hébergement, domaine, courriels). **Maquettes** : aucune.

**Périmètre**
- **Sécurité** : limites de débit sur toutes les routes publiques d'écriture (connexion, OTP, messages, réservations, demandes, clics, vues) ; en-têtes de sécurité (CSP, HSTS, X-Content-Type-Options, Referrer-Policy) ; cookies sécurisés ; vérification que tout texte utilisateur est échappé (aucun HTML dans la présentation) ; téléversements revérifiés ; revue de toutes les routes `/api/studio/**` (propriétaire uniquement, **test d'accès croisé** : l'utilisateur A ne lit ni ne modifie rien de l'utilisateur B) ; secrets hors du dépôt.
- **Données** : sauvegarde quotidienne de PostgreSQL et du dossier d'images, **restauration testée**, rétention définie ; export des données de l'utilisateur et suppression du compte (RGPD) avec effacement des images ; pages **CGU et confidentialité** (textes fournis par Cabrel ; ne pas les inventer, placer des marqueurs).
- **Observabilité** : journaux structurés, suivi d'erreurs (Sentry), alerte sur échec de jobs, vérification de santé (`/api/health`) surveillée.
- **Déploiement** : Nginx (HTTPS, compression, cache des fichiers statiques et des images), PM2 (application + worker), variables de production validées, migrations appliquées au déploiement, **procédure de retour arrière**, `README` d'exploitation (démarrer, arrêter, déployer, restaurer, lire les journaux).
- **Tests de fin** : e2e du parcours complet (connexion → inscription guidée → vitrine → réservation par un visiteur → confirmation → abonnement de test), test de charge léger sur les pages publiques, essai complet sur de vrais téléphones.
- **Liste de contrôle de mise en production** vérifiée point par point dans le rapport.

**Critères de réception** : tous les points de la liste de contrôle cochés avec preuve ; restauration d'une sauvegarde réussie sur une base vide ; test d'accès croisé vert ; déploiement et retour arrière exécutés une fois à blanc.

---

## Annexe — Idées gardées pour après la v1

Paiement en ligne des réservations par Brandself (reversement, commission, vérification des professionnels) · OTP et notifications par WhatsApp · factures PDF des abonnements · invitation de témoignage par lien · import LinkedIn ou CV · domaine personnalisé · version bilingue · boutique · blog · templates supplémentaires.
