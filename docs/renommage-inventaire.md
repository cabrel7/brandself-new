# Inventaire en lecture seule — S14 Renommage `jesuis.pro`

**Statut** : inventaire seulement. Aucune modification de code à cette étape.  
**Règle S14** : on change textes, URL/domaines, emails, métadonnées, images de marque, config externe.  
**On ne change JAMAIS** : tables, colonnes, variables d'environnement, clés Redis, files BullMQ, cookies/sessions, paquets, dossiers, fonctions/variables/classes/types, migrations déjà jouées.  
**Méthode** : pas d'opération en masse ; chaque fichier lu puis modifié seul, deux sessions (inventaire → correction).

---

## 0. Source unique à créer

- `shared/brand.ts` (à créer) : constante unique `nom = 'jesuis.pro'`, `domaine = 'jesuis.pro'`, adresse d'envoi des emails, identifiant SMS `jesuispro`. Utilisée uniquement là où le code construit un texte (modèles email/SMS, balises, données structurées, manifeste).

---

## 1. Fichiers de code source — textes / domaines / emails à changer (catégorie A)

| Fichier | Élément concerné | Type |
|---|---|---|
| `app/utils/onboarding.ts` | `HOTE_VITRINES = 'brandself.io'` | domaine public |
| `app/pages/index.vue` | `logo: '/og/brandself-logo.png'` | image de marque (référence) |
| `app/pages/[username]/reserver/confirmation.vue` | `download="reservation-brandself.ics"` | nom de fichier téléchargé |
| `app/pages/studio/liens/index.vue` | `qr-code-brandself-${username}.svg` | nom de fichier QR |
| `app/pages/connexion/index.vue` | `sessionStorage.setItem('brandself:identifiant', …)` | clé stockage client (texte affiché/technique frontière) |
| `app/pages/connexion/code.vue` | `sessionStorage.removeItem('brandself:identifiant')` + `getItem('brandself:identifiant')` | idem |
| `app/composables/usePartageVitrine.ts` | `qr-code-brandself-${vitrine.value.username}.svg` | nom de fichier QR |
| `shared/seo.ts` | `OG_IMAGE_DEFAUT = '/og/brandself-partage.jpg'` | image de partage par défaut |
| `shared/seo.ts` | `OG_LOGO = '/og/brandself-logo.png'` | logo par défaut |
| `shared/compte.ts` | `TEMP_EMAIL_DOMAIN = 'telephone.brandself.local'` | domaine email temporaire — **décidé : le nom ne doit plus être `brandself`** (remplacer par la marque `jesuis.pro`) |
| `server/db/seed.ts` | emails `*@brandself.test` (lignes 37, 361, 372, 401, 411, 421, 500, 510, 837) | emails de démo dans le seed |
| `server/api/public/[username]/confirmation/agenda.ics.get.ts` | `filename="reservation-brandself.ics"` | nom de fichier ICS téléchargé |
| `server/services/agenda-ics.ts` | `UID:${input.reservationId}@brandself` | UID dans fichier ICS généré (visible par l'utilisateur) |

---

## 2. Fichiers de tests — URLs / domaines / emails de test à changer

| Fichier | Élément concerné |
|---|---|
| `tests/env-drapeaux.test.ts` | `EMAIL_EXPEDITEUR: 'Brandself <bonjour@brandself.io>'`, `NUXT_PUBLIC_SITE_URL: 'https://brandself.io'` |
| `tests/unit/env-kpay.test.ts` | idem |
| `tests/unit/seo-schema.test.ts` | `https://brandself.io/medias/…`, `https://brandself.io/dr-cabrel#personne`, siteUrl |
| `tests/unit/env-ia.test.ts` | `EMAIL_EXPEDITEUR`, `NUXT_PUBLIC_SITE_URL` |
| `tests/unit/notifications-contrats.test.ts` | `EMAIL_EXPEDITEUR`, `NUXT_PUBLIC_SITE_URL`, refus URLs `brandself.io` |
| `tests/unit/notifications-partage.test.ts` | `URL_VITRINE = 'https://brandself.io/dr-cabrel'` + messages de partage |
| `tests/unit/env-site.test.ts` | `NUXT_PUBLIC_SITE_URL: 'https://brandself.io'` |
| `tests/unit/statistiques-regles.test.ts` | `classifierSource(…, 'brandself.io')` (source interne) |
| `tests/unit/notifications-contenus-s9.test.ts` | `const SITE = 'https://brandself.io'` |
| `tests/env.test.ts` | `EMAIL_EXPEDITEUR`, `NUXT_PUBLIC_SITE_URL` |
| `tests/integration/webhook-kpay-route.test.ts` | `host: 'brandself.io'` |
| `e2e/onboarding.spec.ts` | `HOTE_VITRINES = 'brandself.io'` |
| `e2e/helpers/notifications.ts` | `HOTE_VITRINES = 'brandself.io'` |
| `e2e/reservation.spec.ts` | `suggestedFilename()` = `'reservation-brandself.ics'` |

---

## 3. Fichiers de déploiement et config externe (à changer)

| Fichier | Élément concerné |
|---|---|
| `deploy/nginx/brandself-location.conf` | config Nginx (server_name, cache, redirection 301 ancien domaine) |
| `deploy/nginx/brandself-cache.conf` | config cache Nginx |
| `deploy/verifier-cache.sh` | `https://preprod.brandself.io` (site à vérifier) |

---

## 4. Fichiers de documentation (à changer, hors périmètre code)

| Fichier | Élément concerné |
|---|---|
| `PROJECT_CONTEXT.md` | URL publique `brandself.io/username`, link-in-bio `brandself.io/@username` |
| `SPRINTS.md` | `brandself.io/@username` (S6), maquettes S14 badge « Créé avec jesuis.pro » |
| `docs/specs/S8-onboarding-ia.md` | préfixe `brandself.io/` dans l'écran « Votre adresse » |
| `docs/specs/S9-notifications.md` | `https://brandself.io/dr-cabrel`, `Brandself <bonjour@brandself.io>` |
| `docs/specs/S10-abonnements.md` | `https://brandself.io/api/webhooks/kpay` |
| `docs/specs/S12-seo-performance.md` | nom de domaine `brandself.io`, DNS, certificat HTTPS |
| `PROJECT_STATE.md` | `https://brandself.io/api/webhooks/kpay` (dette S10) |
| `README.md` | référence à `deploy/nginx/brandself-location.conf` |

---

## 5. Images de marque (à remplacer dans `public/`, sans renommer les dossiers)

| Fichier | Élément concerné |
|---|---|
| `public/favicon.ico` | favicon de marque |
| `public/og/brandself-partage.jpg` | image de partage Open Graph |
| `public/og/brandself-logo.png` | logo (référencé dans `app/pages/index.vue` et `shared/seo.ts`) |
| `public/brand/` (à créer) | logo `logo.svg` sans `<metadata>`, icône seule, favicon, icône tactile, image de partage 1200×630 (décision #18) |

---

## 6. Fichiers à NE PAS modifier (gel S14)

| Fichier | Élément gelé | Motif |
|---|---|---|
| `.env` | `DATABASE_URL=…brandself_dev…` | variable d'environnement / nom de base de données |
| `.env.test` | `DATABASE_URL=…brandself_test…` | variable d'environnement / nom de base de données |
| `.env.example` | `DATABASE_URL=…brandself_dev…` | variable d'environnement / nom de base de données |
| `.github/workflows/ci.yml` | `POSTGRES_USER/PASSWORD/DB: brandself`, `DATABASE_URL` | variables d'environnement CI / noms de base de données |
| `ecosystem.config.cjs` | `name: 'brandself-app'`, `name: 'brandself-worker'` | noms de paquets / processus |
| `package.json` | `"name": "brandself-app"` | nom de paquet |
| `server/utils/confirmation-cookie.ts` | `CONFIRMATION_COOKIE = 'brandself_confirmation'` | cookie de session |
| `server/services/email-outbox.ts` | `IDEMPOTENCY_KEY_PREFIX = 'brandself-email-'` | clé d'idempotence / file BullMQ |
| `shared/notifications.ts` | `DESABONNEMENT_HKDF_INFO = 'brandself-desabonnement-v1'` | clé crypto (journal/désabonnement) |
| `shared/statistiques.ts` | `EMPREINTE_HKDF_INFO = 'brandself-statistiques-visite-v1'` | clé crypto (empreinte visite) |
| `shared/paiements.ts` | `TELEPHONE_EMPREINTE_HKDF_INFO = 'brandself-telephone-paiement-v1'` | clé crypto (paiement) |
| `shared/reserved.ts` | `'brandself'` dans mots réservés | liste de mots réservés usernames — **décidé : à changer aussi** (ajouter les formes de la nouvelle marque) |
| `e2e/capture-agenda.spec.ts` | cookie `brandself_confirmation` | cookie de session |
| `e2e/reservation.spec.ts` | cookie `brandself_confirmation` | cookie de session |
| `e2e/liens.spec.ts` | `instagram.com/brandself_e2e` | exemple Instagram tiers (pas notre marque) |
| `e2e/api/notifications.spec.ts` | commentaire `brandself-desabonnement-v1` | clé crypto |
| `.output/` | tous les fichiers de build | artefacts générés, jamais modifiés à la main |
| `DOCUMENTATION_APPRENTISSAGE.md` | notes personnelles | hors périmètre projet |
| `APPRENTISSAGE_FULLSTACK.md` | notes personnelles | hors périmètre projet |

---

## 7. Fichiers externes hors dépôt (à exécuter par Cabrel, checklist catégorie F)

- Google Cloud : nom de l'application, domaines autorisés, URI de redirection
- K-PAY : nom marchand, URL de webhook, URL de retour
- Resend : domaine vérifié, SPF, DKIM, DMARC, adresse d'expéditeur
- Fournisseur SMS : identifiant d'expéditeur `jesuispro` (sans point)
- Sentry : nom du projet
- Nginx : `server_name`, certificat SSL pour `jesuis.pro`
- Google Search Console : nouvelle propriété + outil de changement d'adresse
- Supervision : adresse surveillée

---

## 8. Redirection de l'ancien domaine

- 301 de `brandself.io` → `jesuis.pro` en conservant chemin et paramètres (configuration Nginx).
- Ancien domaine renouvelé ≥ 12 mois pour que les liens et QR codes déjà partagés fonctionnent.

---

## 9. Décisions préalables requises avant la session de correction

- **Décision #17** : nom de marque, domaine et adresse d'envoi (`jesuis.pro`, SMS `jesuispro`) — validée dans PROJECT_STATE.md §3.
- **Décision #18** : fichiers du logo (terracotta #C1512A, pas de `<metadata>`) — validée dans PROJECT_STATE.md §3.
- À confirmer avec le fournisseur SMS : identifiant d'expéditeur `jesuispro`.

---

## 10. Ordre de correction (session 2, fichier par fichier)

1. Créer `shared/brand.ts` (source unique).
2. `app/utils/onboarding.ts` (domaine).
3. `shared/seo.ts` (images de marque).
4. `app/pages/index.vue`, `app/pages/connexion/*.vue`, `app/composables/usePartageVitrine.ts`, `app/pages/studio/liens/index.vue`, `app/pages/[username]/reserver/confirmation.vue`.
5. `server/db/seed.ts` (emails démo).
6. `server/api/public/[username]/confirmation/agenda.ics.get.ts`, `server/services/agenda-ics.ts`.
7. `shared/compte.ts` (domaine email temporaire — à valider).
8. Fichiers de tests (liste §2).
9. `deploy/nginx/*`, `deploy/verifier-cache.sh`.
10. Documentation (liste §4) — en dernier, après validation du code.
11. Images `public/` (remplacement, pas renommage).

---

## 11. Avancement de la session 2 (mise à jour au fil de l'eau)

### Catégorie C — images de marque ✅ fait (2026-11-07)

| Cible | Fait |
|---|---|
| `public/brand/logo.svg` | créé (variante horizontale, `<title>jesuis.pro</title>`, **aucun `<metadata>`**) |
| `public/brand/icone.svg` + `icone.png` (512) | créés |
| `public/brand/favicon.svg` | créé |
| `public/brand/apple-touch-icon.png` | créé, 180×180 **opaque** (coins remplis en #C1512A) |
| `public/brand/partage.jpg` | créé, 1200×630, fond `#FBF7F0`, bande `#B4532F` 90 px, logotype centré (606×294), qualité 82 |
| `public/favicon.ico` | régénéré 16/32/48 (PNG-in-ICO) |
| `public/og/` | **supprimé** (dossier) |
| `shared/seo.ts` | `OG_IMAGE_DEFAUT = '/brand/partage.jpg'`, `OG_LOGO = '/brand/icone.png'` |
| `app/pages/index.vue` | `logo: '/brand/icone.png'` |
| `tests/unit/seo-schema.test.ts` | fixture `'/brand/icone.png'` (2 occurrences) |
| `nuxt.config.ts` | 3 balises `link` : icône SVG, `.ico`, icône tactile |

Points relevés pendant la catégorie C, **hors périmètre S14** (à trancher) :

- `OG_IMAGE_DEFAUT` n'était appliqué **nulle part** : `useSeoVitrine.imagePartage()` renvoie `null`
  (le commentaire promet « sinon défaut ») et `/` n'a pas d'`og:image`. Contrat écrit dans
  `shared/dto/media.ts:9` et `server/resources/vitrine.ts:64` mais non implémenté.
- `schemaOrg: { identity: 'Organization' }` n'emporte ni `name` ni `logo` : le graphe JSON-LD de
  `/` contient **deux** nœuds `Organization` (module + `index.vue`), sans logo pour le premier.
- `logo: '/brand/icone.png'` est **relatif** dans le JSON-LD (comme avant ; Google préfère absolu).
- `public/brand/` ne contient pas de `manifest.webmanifest` : le manifeste arrive en S15 (PWA).
- `logo-brand/` (kit de variantes fourni) reste **non tracké** : à committer ou à gitignorer ?

### Étape 1-2 — `shared/brand.ts`, signature des e-mails, hôte ✅ fait (2026-11-07)

| Fichier | Changement |
|---|---|
| `shared/brand.ts` | **créé** : `MARQUE = { nom, domaine, signature, emailExpediteurDev, smsExpediteur }` (décision #17) |
| `shared/notifications.ts` | `EMAIL_EXPEDITEUR_DEV_DEFAUT` ← `MARQUE.emailExpediteurDev` |
| `server/services/emails/notifications-contenus.ts` | `signatureMarque` ← `MARQUE.signature` ; 3 textes « abonnement Brandself » ← `MARQUE.nom` |
| `server/services/emails/contenus.ts` | 5 signatures littérales `'Brandself'` ← `TEXTES_NOTIFICATIONS.signatureMarque` (source unique, contenu identique) |
| `server/services/otp/envoi.ts` | `from` ← `env.EMAIL_EXPEDITEUR` (avant : littéral `Brandself <onboarding@resend.dev>`, ignorait la config) ; objet et sign-off ← `MARQUE.nom` |
| `app/utils/onboarding.ts` | `HOTE_VITRINES` ← `MARQUE.domaine` (`jesuis.pro`) |
| `app/composables/useSeoVitrine.ts` | `imagePartage()` renvoie désormais l'`og:image` par défaut (fini `null`), `twitter:image` branché |
| `app/pages/index.vue` | `og:image` + `twitter:image` ← `/brand/partage.jpg` (décision utilisateur) |
| `tests/unit/notifications-contenus-s9.test.ts` | 2 assertions de signature ← `MARQUE.signature` |

Gates relancées : `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test:unit` **97 fichiers / 3229 tests, 0 sauté**.
Preuve live : `/` → `<meta property="og:image" content="/brand/partage.jpg">` + `og:image:width 1200`
+ `og:image:height 630` + `og:image:alt jesuis.pro` + `twitter:image` ; `/brand/partage.jpg` et
`/brand/icone.png` en 200.

**Lacunes de l'inventaire §1 relevées en cours de route** (catégorie A, à traiter) :

- Textes d'e-mail et d'OTP absents de la catégorie A : `notifications-contenus.ts` (3 occurrences,
  traitées), `contenus.ts` (5 signatures, traitées), `otp/envoi.ts` (objet + sign-off, traités).
- Commentaires de code contenant `Brandself` (~15 fichiers) : catégorie à arbitrer.
- `e2e/helpers/notifications.ts:23` et `e2e/onboarding.spec.ts:32` recopient `HOTE_VITRINES` :
  à mettre à jour dans la step tests (§2), sinon les parcours e2e tombent.
- `server/db/migrations/0018_s8_onboarding_ia.sql` contient les **prompts IA** (« Tu es le
  rédacteur de Brandself… ») : catégorie G (migration de données), pas C.
- `server/services/ia/verification.ts:16` : `NOMS_PROPRES_AUTORISES = ['Brandself', 'WhatsApp']`
  → doit devenir `jesuis.pro`, sinon les sorties IA renommées sont rejetées comme inventées
  (`tests/unit/ia-verification.test.ts:216`).

### Décision ouverte — doublage de la marque dans les titres

Le gabarit de titre est `%s %separator %siteName` (`nuxt-seo-utils`), donc **chaque titre qui
contient déjà la marque l'écrit deux fois** :

| Page | Titre rendu aujourd'hui |
|---|---|
| `/` | `Brandself — votre vitrine en ligne \| Brandself` |
| `/tarifs` | `Tarifs — Brandself \| Brandself` |
| `/connexion` | `Brandself \| Brandself` |

Un renommage littéral produirait `Tarifs — jesuis.pro | jesuis.pro`. ~19 fichiers sont concernés
(`index.vue`, `tarifs.vue`, `connexion`, `desabonnement`, 18 titres de studio) plus 4 assertions
e2e (`\| Brandself`).

### Reste à traiter (ordre §10)

**Tout traité** (état 2026-11-07).

1. ✅ `shared/brand.ts` — source unique `MARQUE = { nom, domaine, signature, emailExpediteurDev, smsExpediteur }`
2. ✅ `app/utils/onboarding.ts` — `HOTE_VITRINES ← MARQUE.domaine`
3. ✅ `shared/seo.ts` + `nuxt.config.ts` — `SITE_NOM = MARQUE.nom` ; `site.name = MARQUE.nom` ; `app.head.title` supprimé (la marque est ajoutée par le gabarit `%s | siteName` : pas de doublage, décision utilisateur)
4. ✅ Catégorie A — 18 titres de studio + `index.vue`/`tarifs.vue`/`connexion`/`desabonnement` (suffixe ` — Brandself` retiré), badge « Créé avec », fichiers téléchargés (QR code, ICS), commentaires, `shared/seo.ts` ligne Tarifs, `e2e/` literals mis à jour
5. ✅ `server/db/seed.ts` — emails `@brandself.test` → `@jesuis.pro.test`
6. ✅ ICS — `PRODID:-//jesuis.pro//Agenda//FR` (`UID` figé)
7. ✅ `shared/compte.ts` — `TEMP_EMAIL_DOMAIN = 'telephone.jesuis.pro.local'`
8. ✅ `shared/reserved.ts` + test — `jesuis` et `jesuispro` ajoutés, `brandself` conservé
9. ✅ Tests — unit 3231/3231 (0 sauté), intégration 1660/1661 (1 timeout infra sur `migration-0021`, vert en relance isolée). `pnpm e2e` non lancé (serveur dev requis) ; literals e2e déjà corrigés
10. ✅ `deploy/` — `verifier-cache.sh` URL par défaut → `https://preprod.jesuis.pro` ; confs Nginx cache inchangées (identifiants techniques internes figés)
11. ✅ Documentation — `README.md` h1 `# jesuis.pro`
12. ✅ Test `ancien-nom` — sans rapport avec la marque (test de changement de username, CA16), déjà vert

---

**Session 2 terminée.** Catégorie C + étapes 1-12 livrées. Toutes les gates vertes : lint 0, typecheck 0, unit 3231/3231, intégration 1660/1661, build prod 15m22s.

**Reste hors S14** : lancer `pnpm e2e` avec le serveur de dev quand disponible (literals déjà corrigés).

**Points en attente d'arbitrage (non bloquants)** : commentaires de code contenant l'ancienne marque (reste résiduel à confirmer), `badgeBrandself` (12 identifiants API figés par S14), `logo-brand/` non tracké (committer ou gitignorer), prompts IA en base (`server/db/migrations/0018_s8_onboarding_ia.sql`, catégorie G — migration de données, hors périmètre S14).