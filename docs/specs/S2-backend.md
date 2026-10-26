# Spec S2 — correction et complétion du backend (Studio, Profil, accueil public)

Source de vérité pour les agents. Rédigée par l'architect le 2026-10-26. Tier standard ; sécurité renforcée sur upload, appareils, suppression de compte et données personnelles.

## 0. Décisions par défaut (à confirmer par l'utilisateur)

| # | Sujet | Défaut |
|---|---|---|
| 16 | Upload synchrone ou job BullMQ | synchrone, borné (10 Mo, 40 MP) |
| 17 | Publier sans photo | autorisé jusqu'à S8 ; exigés : prenom, nom, metier, ville, pays |
| 18 | Liste PAYS | CM, SN, CI, GA, CG, CD, BJ, TG, BF, ML, NE, TD, CF, GN, MG, RW, BI, DJ, KM, FR, BE, CH, CA, LU, MA, TN, DZ, US, GB, DE |
| 19 | DEVISES | XAF, EUR, USD |
| 20 | LOCALES | fr |
| 21 | ACCROCHE_MAX / BIO_MAX | 160 / 2000 |
| 22 | Médias à chemin absolu en base (dev) | supprimés par 0009 |

## 1. Constats confirmés (audit)

Fuite email/téléphone/chemin disque sur `/api/public/:username` ; route `medias.:id` inatteignable (le point n'est pas un séparateur) ; aucune couche service, objets ORM bruts renvoyés ; PUT vitrine n'accepte que titre/prénom/nom/métier ; aucune route de service des médias ; username-disponible compare vitrine.id à userId ; POST vitrine 500 sur doublon ; moi.put écrase par défauts ; publier réécrit publieeLe ; pas de ssr:false sur /studio/** ; appareils et suppression de compte absents.
Autres constats : `statusMessage` h3 supprime les caractères non ASCII ; le hook `error` ne fait que journaliser (DomainError => 500) ; `moi.get` renvoie `aUneVitrine:false` en dur et l'email temporaire `…@telephone.brandself.local` ; snapshots drizzle seulement jusqu'à 0001 ; noms de contraintes en base (`vitrines_username_key`, `vitrines_user_id_key`) ≠ drizzle (`*_unique`) ; `temoignages_slug_idx` et `liens_slug_idx` UNIQUE globaux (0006, 0008) ≠ schema.ts ; `storage/` absent de .gitignore ; largeur/hauteur lues avant rotation EXIF ; `/api/public/services.get.ts` masque un username `services` ; routes publiques realisations/temoignages absentes ; seed `titre='Dr Cabrel Nguesso'`, `pays='Cameroun'`.

## 2. Convention de nommage des routes

Un dossier par ressource. `index.<méthode>.ts` pour collection/singleton ; `[param].<méthode>.ts` pour un élément ; `[param]/<action>.<méthode>.ts` ou `<ressource>/<action>.<méthode>.ts` pour une action. **Jamais de point avant un crochet** (`x.[id].ts` interdit ; garde-fou : test U8). Studio : `[id]` (uuid). Public : `[username]` puis `[slug]`. Fichiers hors /api : `server/routes/`.

Renommages S2 (URL inchangées sauf DELETE médias) :
- `studio/vitrine.{get,post,put}.ts` -> `studio/vitrine/index.{get,post,put}.ts` ; `vitrine/publier.post.ts`, `depublier.post.ts` inchangés ; nouveau `vitrine/username.put.ts`
- `studio/moi.{get,put}.ts` -> `studio/moi/index.{get,put}.ts` + `index.delete.ts` (nouveau)
- `studio/medias.post.ts` -> `studio/medias/index.post.ts` ; `medias.[id].delete.ts` -> `medias/[id].delete.ts`
- nouveau `studio/appareils/index.get.ts`, `appareils/[id].delete.ts`
- `public/[username].get.ts` -> `public/[username]/index.get.ts`
- nouveau `server/routes/medias/[id]/[fichier].get.ts`
Renommages S3 à S6 (hors S2, traités dans leurs sprints) : services, realisations, temoignages, liens (studio `[id]`, public `[username]/…`).

## 3. Migration `0009_s2_vitrines_medias.sql` (nouvelle ; 0002 intacte)

Procédure : modifier `shared/db/schema.ts` ; `pnpm db:generate --name s2_vitrines_medias` ; **remplacer** le SQL généré par celui ci-dessous en gardant `meta/0009_snapshot.json` aligné sur schema.ts ; un second `db:generate` doit dire « No schema changes » ; aligner schema.ts de façon déclarative sur la base réelle des tables S3 à S6 (`uniqueIndex` sur `temoignages_slug_idx` et `liens_slug_idx`). Vérifier d'abord les noms réels avec `\d vitrines`.

```sql
UPDATE vitrines SET photo_media_id = NULL WHERE photo_media_id IN (SELECT id FROM medias WHERE chemin LIKE '/%');
DELETE FROM medias WHERE chemin LIKE '/%';
ALTER TABLE vitrines ALTER COLUMN titre DROP NOT NULL;
UPDATE vitrines SET titre = CASE lower(replace(split_part(trim(titre),' ',1),'.',''))
  WHEN 'dr' THEN 'dr' WHEN 'pr' THEN 'pr' WHEN 'me' THEN 'me' WHEN 'm' THEN 'm' WHEN 'mme' THEN 'mme' ELSE NULL END;
ALTER TABLE vitrines ADD CONSTRAINT vitrines_titre_check CHECK (titre IS NULL OR titre IN ('dr','pr','me','m','mme'));
ALTER TABLE vitrines ALTER COLUMN ville DROP NOT NULL, ALTER COLUMN pays DROP NOT NULL;
UPDATE vitrines SET ville = NULLIF(trim(ville),''),
  pays = CASE WHEN pays ~ '^[A-Z]{2}$' THEN pays WHEN lower(trim(pays)) = 'cameroun' THEN 'CM' ELSE NULL END;
ALTER TABLE vitrines ADD CONSTRAINT vitrines_pays_check CHECK (pays IS NULL OR pays ~ '^[A-Z]{2}$');
UPDATE vitrines SET palette = 'terracotta' WHERE palette NOT IN ('terracotta','sauge','indigo','ocre','bordeaux');
ALTER TABLE vitrines ADD CONSTRAINT vitrines_palette_check CHECK (palette IN ('terracotta','sauge','indigo','ocre','bordeaux'));
ALTER TABLE vitrines ADD CONSTRAINT vitrines_username_format_check
  CHECK (char_length(username) BETWEEN 3 AND 30 AND username ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE vitrines RENAME CONSTRAINT vitrines_username_key TO vitrines_username_unique;
ALTER TABLE vitrines RENAME CONSTRAINT vitrines_user_id_key TO vitrines_user_id_unique;
DROP INDEX IF EXISTS vitrines_username_idx; DROP INDEX IF EXISTS vitrines_user_id_idx;
UPDATE vitrines v SET photo_media_id = NULL WHERE photo_media_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM medias m WHERE m.id = v.photo_media_id);
ALTER TABLE vitrines ADD CONSTRAINT vitrines_photo_media_id_medias_id_fk
  FOREIGN KEY (photo_media_id) REFERENCES medias(id) ON DELETE SET NULL;
CREATE INDEX vitrines_photo_media_id_idx ON vitrines (photo_media_id);
ALTER TABLE medias ADD CONSTRAINT medias_taille_check CHECK (taille > 0);
```
Ajouter en fin de fichier un bloc `-- ROLLBACK` commenté (DROP des contraintes/index/FK, RENAME inverse, `UPDATE … SET ville = COALESCE(ville,'')` puis `SET NOT NULL`) ; tester up -> down -> up sur la base de test.

schema.ts : `titre`, `ville`, `pays` nullables ; `check()` sur titre, pays, palette, username ; `photoMediaId.references(() => medias.id, { onDelete: 'set null' })` + index ; suppression de `vitrines_username_idx` et `vitrines_user_id_idx`. `medias.chemin` = clé de stockage relative `{userId}/{mediaId}` ; `mime` toujours `image/webp` ; largeur/hauteur = variante 1600 après rotation.
Seed : `titre:'dr'`, `pays:'CM'`, `ville:'Douala'`, pas de photo, `emailContact:null`.

## 4. Contrats partagés (`shared/`)

- `shared/palettes.ts` : `PALETTES = ['terracotta','sauge','indigo','ocre','bordeaux'] as const`, type `Palette`, `DEFAULT_PALETTE='terracotta'`, `PALETTE_LABELS`.
- `shared/vitrine.ts` : `TITRES=['dr','pr','me','m','mme']`, `TITRE_LABELS {dr:'Dr',pr:'Pr',me:'Me',m:'M.',mme:'Mme'}`, `PAYS` (`{code,label}[]`) + `PAYS_CODES`, `PRENOM_MAX=60`, `NOM_MAX=60`, `METIER_MAX=80`, `VILLE_MAX=80`, `ACCROCHE_MAX=160`, `BIO_MAX=2000`, `PUBLICATION_REQUIRED_FIELDS=['prenom','nom','metier','ville','pays']`, `NEXT_STEPS=['photo','service','realisation']`, `displayName(titre, prenom, nom)`.
- `shared/medias.ts` : `MEDIA_MAX_BYTES=10*1024*1024`, `MULTIPART_OVERHEAD_BYTES=64*1024`, `MEDIA_MAX_PIXELS=40_000_000`, `MEDIA_WIDTHS=[400,800,1600]`, `MEDIA_ACCEPTED_MIME=['image/jpeg','image/png','image/webp']`, `MEDIA_FORM_FIELD='fichier'`, `mediaUrl(id,w)` -> `/medias/${id}/${w}.webp`, `mediaSrcset(id)`.
- `shared/compte.ts` : `LOCALES=['fr']`, `DEVISES=['XAF','EUR','USD']`, `ACCOUNT_DELETION_PHRASE='SUPPRIMER'`, `FRESH_SESSION_MAX_AGE_S=86_400`, `TEMP_EMAIL_DOMAIN='telephone.brandself.local'`.
- `shared/limites.ts` : `USERNAME_CHECK_LIMIT=30` / 60 s par utilisateur ; `MEDIA_UPLOAD_LIMIT=30` / 3600 s par utilisateur.
- `shared/fuseau.ts` : `isValidTimeZone(tz)` (Intl.DateTimeFormat, try/catch). `shared/telephone.ts` : `E164_REGEX=/^\+[1-9]\d{6,14}$/`.
- `shared/erreurs.ts` : `ERROR_CODES` et type `ErrorCode` (voir §5).
- `shared/reserved.ts` : ajouter `medias`, `compte`, `brandself`, `support`, `blog`, `mentions-legales`, `services`.
- `shared/schemas/vitrine.ts` : préprocesseur `''`/espaces -> null ; `schemaVitrineCreate = z.object({titre: enum nullable default null, prenom, nom, metier, username}).strict()` ; `schemaVitrineUpdate = z.object({titre, prenom, nom, metier, ville nullable, pays enum(PAYS_CODES) nullable, accroche, bio, photoMediaId uuid nullable, emailContact email max254 nullable, telephone, whatsapp (E164 nullable), palette enum}).partial().strict().refine(non vide)` ; `schemaUsernameChange = z.object({username}).strict()`.
- `shared/schemas/moi.ts` : `schemaMoiUpdate = z.object({locale, devise, fuseau: refine(isValidTimeZone)}).partial().strict().refine(non vide)` ; `schemaAccountDeletion = z.object({confirmation: z.string()}).strict()`.
- `shared/schemas/username.ts` inchangé + `schemaUsernameQuery = z.object({username: z.string().max(64)})`.
- `shared/dto/*.ts` (types seulement), voir §5.
- `package.json` : dépendance `unstorage ^1.17.6` ; scripts `test` (vitest run, deux projets), `test:unit`, `test:integration`.

## 5. Contrats API

Erreurs (toutes routes) : `{ statusCode, statusMessage: <ASCII>, message: <FR vouvoiement>, data: { code: ErrorCode, champs?, manquants?, retryAfter? } }`.

| Code | HTTP |
|---|---|
| VALIDATION (champs = z.flattenError().fieldErrors) | 400 |
| FICHIER_MANQUANT, CONFIRMATION_INVALIDE | 400 |
| SESSION_TROP_ANCIENNE | 403 |
| VITRINE_INTROUVABLE, MEDIA_INTROUVABLE, APPAREIL_INTROUVABLE | 404 |
| VITRINE_EXISTE, USERNAME_PRIS | 409 |
| TAILLE_REQUISE | 411 |
| FICHIER_TROP_LOURD | 413 |
| TYPE_NON_SUPPORTE | 415 |
| IMAGE_ILLISIBLE, IMAGE_TROP_GRANDE, MEDIA_INVALIDE, PUBLICATION_INCOMPLETE, SESSION_ACTUELLE | 422 |
| TROP_DE_REQUETES (+ en-tête Retry-After) | 429 |
| ERREUR_INTERNE (message générique, jamais error.message) | 500 |

DTO :
```ts
MediaDTO          { id; url /*1600*/; srcset; largeur; hauteur }
VitrineStudioDTO  { username; titre: Titre|null; prenom; nom; nomAffiche; metier; ville: string|null; pays: string|null;
                    accroche; bio; photo: MediaDTO|null; emailContact; telephone; whatsapp; palette: Palette; fuseau;
                    publiee: boolean; publieeLe: string|null; creeLe; modifieLe }
StudioResumeDTO   { compteurs: {services;realisations;temoignages;liens}; prochaineEtape: NextStep|null;
                    manquantsPourPublier: PublicationField[]; statistiques7j: {visites:0;clics:0;reservations:0} }
VitrinePubliqueDTO{ username; titre; nomAffiche; prenom; nom; metier; ville; pays; paysLibelle; accroche; bio;
                    photo: MediaDTO|null; contact:{email;telephone;whatsapp}; palette; fuseau; seo:{titre;description} }
MoiDTO            { id; email: string|null /*null si domaine temporaire*/; telephone; locale; devise; fuseau;
                    aUneVitrine: boolean; vitrine: {username; publiee}|null }
AppareilDTO       { id; userAgent: string|null /*256 max*/; creeLe; derniereActivite; expireLe; actuel: boolean }
```
Le DTO public ne contient jamais : id, userId, user, chemin, disk, sectionsMasquees, réglages d'agenda, users.email, users.telephone. `seo.titre = seoTitre ?? "${nomAffiche} — ${metier} à ${ville}"` ; `seo.description = seoDescription ?? accroche ?? "${nomAffiche}, ${metier} à ${ville}."`.

Routes (`/api/studio/**` : 401 sans session) :
- GET `/api/studio/vitrine` -> 200 `{vitrine, resume}` ; 404
- POST `/api/studio/vitrine` (schemaVitrineCreate) -> 201 `{vitrine, resume}` ; 400, 409 VITRINE_EXISTE/USERNAME_PRIS
- PUT `/api/studio/vitrine` (schemaVitrineUpdate) -> 200 ; 400, 404, 422 MEDIA_INVALIDE
- PUT `/api/studio/vitrine/username` -> 200 ; 400, 404, 409
- POST `/api/studio/vitrine/publier` -> 200 (idempotent) ; 404, 422 PUBLICATION_INCOMPLETE + `manquants`
- POST `/api/studio/vitrine/depublier` -> 200 ; 404
- GET `/api/studio/username-disponible?username=` -> 200 `{username, disponible, raison:'libre'|'actuel'|'pris'|'reserve'|'format'}` ; 429
- GET `/api/studio/moi` -> 200 `{moi}` ; PUT -> 200 `{moi}` (400) ; DELETE (schemaAccountDeletion) -> 204 ; 400 CONFIRMATION_INVALIDE, 403 SESSION_TROP_ANCIENNE
- POST `/api/studio/medias` (multipart, partie `fichier`) -> 201 `{media}` ; 400, 411, 413, 415, 422, 429
- DELETE `/api/studio/medias/:id` -> 204 ; 404
- GET `/api/studio/appareils` -> 200 `{appareils}` (tri derniereActivite décroissante) ; DELETE `/api/studio/appareils/:id` -> 204 ; 404, 422 SESSION_ACTUELLE
- GET `/api/public/:username` (param `trim().toLowerCase()`, format invalide -> 404 sans requête) -> 200 `{vitrine: VitrinePubliqueDTO}` ; 404
- GET `/medias/:id/:largeur.webp` (public, id uuid, largeur ∈ MEDIA_WIDTHS) -> 200 binaire, `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `ETag "<id>-<w>"` ; 304 si If-None-Match ; 404

Upload : vérifier `Content-Length` AVANT de lire le corps (absent -> 411 ; > MEDIA_MAX_BYTES + MULTIPART_OVERHEAD_BYTES -> 413) ; fichier > MEDIA_MAX_BYTES -> 413 ; octets magiques puis `sharp.metadata().format` concordant ; `limitInputPixels: MEDIA_MAX_PIXELS`, `failOn:'error'`, `.rotate()`, puis `clone()` par largeur -> `resize({width:w,height:w,fit:'inside',withoutEnlargement:true}).webp({quality:82})` ; métadonnées non conservées.

## 6. Découpage serveur

- `server/utils/api.ts` : `defineApiHandler(handler)` (à utiliser dans TOUTES les routes S2) : laisse passer les H3Error ; DomainError -> `createError({statusCode, statusMessage: <ASCII>, message, data:{code,...}})` ; autre erreur : journal `{chemin, nom}` sans données personnelles puis 500 ERREUR_INTERNE.
- `server/utils/validation.ts` : `readBodyWith`, `readQueryWith`, `readParamsWith` (safeParse -> ValidationError 400).
- `server/exceptions/http.ts` : `DomainError(code, message, status, data?)` + `ValidationError`, `NotFoundError(code)`, `ConflictError(code)`, `UnprocessableError(code)`, `PayloadTooLargeError`, `LengthRequiredError`, `UnsupportedMediaTypeError`, `ForbiddenError(code)`, `TooManyRequestsError(retryAfter)`.
- `server/utils/stockage.ts` : `createStorage` + `fsDriver({base: env.MEDIAS_DIR})` d'unstorage (pas `useStorage()` de Nitro, pour tester hors Nitro) ; `mediaKey(userId, mediaId, w)` -> `${userId}:${mediaId}:${w}.webp` ; ids validés `^[A-Za-z0-9_-]+$`. `shared/env.ts` : `MEDIAS_DIR: z.string().default('./storage/medias')`.
- `server/services/limiteur.ts` : `hitLimit(key, limit, windowS)` (Redis INCR+EXPIRE, préfixe `limite:`) et `enforceLimit` (lève TooManyRequestsError).
- `server/services/vitrines.ts` (aucun accès à `event`) : `createVitrine` (fuseau = users.fuseau ; 23505 sur `vitrines_user_id_unique` -> VITRINE_EXISTE, sur `vitrines_username_unique` -> USERNAME_PRIS), `getOwnVitrine` (photo en jointure), `updateVitrine` (photoMediaId appartient à userId sinon MEDIA_INVALIDE ; transaction ; après commit `deleteMediaIfUnreferenced` sur l'ancienne photo, échec journalisé), `changeUsername`, `publishVitrine` (manquants -> 422 ; `publiee_le = COALESCE(publiee_le, now())`), `unpublishVitrine`, `getStudioSummary` (compte les lignes actives), `getPublicVitrine(username)` (une requête, `publiee_le IS NOT NULL`, jointure gauche medias), `checkUsernameAvailability(userId, raw)` (enforceLimit puis raison) ; fonctions pures `computeMissingForPublication`, `computeNextStep({hasPhoto, servicesActifs, realisationsActives})`.
- `server/services/medias.ts` : `detectImageType(buf)` (pure), `uploadMedia(userId, data)` (taille -> type -> décodage -> 3 variantes -> insertion ; **compensation** : si l'insertion échoue, supprimer les fichiers écrits ; erreur sharp -> IMAGE_ILLISIBLE ; dépassement pixels -> IMAGE_TROP_GRANDE ; limite d'upload appliquée), `deleteMedia(userId, mediaId)` (filtré propriétaire, sinon MEDIA_INTROUVABLE), `deleteMediaIfUnreferenced(userId, mediaId)` (vérifie vitrines, services, realisations), `readMediaVariant(mediaId, w)`, `deleteAllUserMediaFiles(userId)`.
- `server/services/utilisateurs.ts` : `getMe(userId)` (lecture en base), `updateMe` (si fuseau change : aussi `vitrines.fuseau`, même transaction), `listDevices(userId, currentSessionId)` (`expires_at > now()`, jamais de token), `revokeDevice(userId, sessionId, currentSessionId)`, `deleteAccount(userId, {confirmation, sessionCreatedAt})` (phrase + fraîcheur de session ; supprime `users` en cascade, PUIS `deleteAllUserMediaFiles` après le commit). Routes maison pour appareils (pas les routes Better Auth qui exposent les tokens) et pour la suppression (pas `deleteUser` de Better Auth).
- `server/resources/` : `vitrine.ts` (toVitrineStudioResource, toVitrinePublicResource, toStudioResumeResource), `media.ts` (toMediaResource), `utilisateur.ts` (toMoiResource, toAppareilResource). Dates en ISO.
- Routes : session via `requireUserSession` (`session.user.id`, `session.session.id`, `session.session.createdAt`) ; aucun SQL dans une route.
- `nuxt.config.ts` : `ssr:false` sur `/studio`, `/studio/**`, `/onboarding` en conservant `auth`. `.gitignore` : `storage/`. `auth.config.ts` : utiliser `TEMP_EMAIL_DOMAIN`.

## 7. Critères d'acceptation (Given/When/Then, résumé)

Création/mise à jour : CA1 création (fuseau repris du compte, palette par défaut, ville/pays NULL, nomAffiche « Dr Cabrel Nguesso ») ; CA2 seconde vitrine -> 409 VITRINE_EXISTE ; CA3 username pris -> 409 USERNAME_PRIS et course Promise.all -> un seul réussit, jamais de 500 ; CA4 PUT partiel ne change que le champ envoyé, `''` -> NULL ; CA5 schéma update rejette username/userId/publieeLe/{} ; CA6 photoMediaId d'un autre utilisateur -> 422 MEDIA_INVALIDE, inchangé ; CA7 remplacement de photo supprime l'ancienne ligne et ses 3 fichiers sauf si référencée ailleurs ; CA8 suppression du média -> photo_media_id NULL (FK) ; CA9 INSERT direct invalide (palette 'rose', titre 'docteur', username 'Bad_Name', pays 'Cameroun') rejeté par CHECK.
Publication : CA10 ville/pays NULL -> 422 PUBLICATION_INCOMPLETE, manquants ['ville','pays'] ; CA11 publication sans photo OK, 2e publication ne change pas publiee_le ; CA12 dépublier -> getPublicVitrine lève VITRINE_INTROUVABLE ; CA13 DTO public = exactement les clés de VitrinePubliqueDTO, `photo.url=/medias/<id>/1600.webp`, `seo.titre='Dr Cabrel Nguesso — Cardiologue à Douala'`, aucun email/userId/chemin, username normalisé ('DR-TEST'), inconnu/format invalide -> NotFound ; CA14 disponibilité (actuel/pris/reserve/format/libre) ; CA15 31e appel/min -> TooManyRequestsError retryAfter>0, B non limité ; CA16 changeUsername (pris -> 409, libre -> OK, ancien libéré) ; CA17 computeNextStep (photo -> service -> realisation -> null), compteurs = lignes actif=true de la vitrine.
Médias : CA18 JPEG 8 Mo 4000×3000 EXIF orientation 6 -> webp, largeur 1200, hauteur 1600, chemin `<A>/<id>`, 3 variantes sans exif ni orientation, height>width ; CA19 PNG et WebP OK ; CA20 octets `MZ…` renommé .jpg -> 415, rien persisté ; CA21 10 Mo+1 -> 413 sans décodage ; HTTP : Content-Length 12 Mo -> 413 avant lecture, absent -> 411 ; CA22 octets JPEG + déchets -> 422 IMAGE_ILLISIBLE ; PNG 10000×10000 -> IMAGE_TROP_GRANDE ; rien persisté ; CA23 userId inexistant (FK) -> erreur ET aucun fichier restant (compensation, sans mock) ; CA24 deleteMedia par B -> MEDIA_INTROUVABLE intact ; par A -> ligne et fichiers supprimés ; CA25 readMediaVariant 800 OK, largeur 500 ou id inconnu -> NotFound ; HTTP /medias/M/800.webp -> 200 + en-têtes, If-None-Match -> 304, après suppression -> 404 ; CA26 31e upload/heure -> 429.
Compte : CA27 compte téléphone : email null, telephone '+237…', aUneVitrine réel ; CA28 updateMe fuseau met à jour users et vitrines, locale/devise inchangés ; 'Mars/Olympus', devise 'GBP', {} -> 400 ; CA29 listDevices : sessions actives de A seulement, actuel:true sur la courante, aucun `token` ; CA30 revokeDevice (autre session OK, session de B -> APPAREIL_INTROUVABLE, courante -> SESSION_ACTUELLE ; e2e : le contexte révoqué reçoit 401) ; CA31 deleteAccount : 'oui' -> CONFIRMATION_INVALIDE ; session de 25 h -> SESSION_TROP_ANCIENNE ; cas valide : users/sessions/accounts/vitrines/medias supprimés, dossier MEDIAS_DIR/<A> supprimé, données de B intactes ; e2e : ensuite /api/studio/moi -> 401 et /api/public/<username> -> 404.
Transversal : CA32 toutes routes /api/studio/** sans session -> 401 ; CA33 GET /api/public/inconnu -> 404 avec data.code VITRINE_INTROUVABLE et message accentué intact ; CA34 DELETE /api/studio/medias/<uuid aléatoire> -> 404 avec data.code MEDIA_INTROUVABLE (preuve que la route existe) ; CA35 parcours POST vitrine -> upload -> PUT -> publier -> GET public -> GET photo -> dépublier -> 404 ; CA36 HTML de GET /studio et /onboarding sans contenu rendu serveur (ssr:false) ; CA37 aucun fichier sous server/api ou server/routes ne correspond à `/\.\[/` hors liste d'exceptions explicite (S3 à S6, qui ne peut que rétrécir).

## 8. Tests

- Unitaires `tests/unit/` (sans base ; les `tests/*.test.ts` existants restent inclus) : U1 username/mots réservés (+medias) ; U2 detectImageType ; U3 displayName ; U4 schémas vitrine ; U5 schemaMoiUpdate ; U6 computeMissing/NextStep ; U7 isValidTimeZone ; U8 convention de routes (CA37) ; U9 mediaUrl/mediaSrcset ; U10 toVitrinePublicResource (liste blanche) ; U11 defineApiHandler (DomainError -> H3Error avec message FR intact ; erreur inconnue -> 500 ERREUR_INTERNE sans le message d'origine).
- Intégration `tests/integration/` (vrais PostgreSQL, Redis, disque ; **aucun mock de db, redis, stockage**) : `vitrines.test.ts` (CA1-4, 6-17), `medias.test.ts` (CA18-26), `utilisateurs.test.ts` (CA27-31), `limiteur.test.ts`. Images générées par sharp pendant le test (aucun binaire commité) ; image 8 Mo : bruit aléatoire 4000×3000, JPEG q100, `withMetadata({orientation:6})`.
- e2e API `e2e/api/*.spec.ts` (Playwright `request`) : `helpers/session.ts` (connexion OTP, code lu en base) ; **une session par fichier** (describe.serial + beforeAll) pour rester sous 10 envois OTP/min/IP ; `studio-auth.spec.ts` (CA32), `public.spec.ts` (CA13, CA33), `medias.spec.ts` (CA21, CA25, CA34), `parcours-vitrine.spec.ts` (CA35, CA36), `compte.spec.ts` (CA30, CA31).
- Infrastructure : `vitest.config.ts` `test.projects` = `unit` (env factice actuel) et `integration` (ne surcharge pas DATABASE_URL/REDIS_URL ; MEDIAS_DIR temporaire ; `fileParallelism:false` ; `globalSetup tests/integration/global-setup.ts` : échoue si DATABASE_URL absente ou nom de base ne finissant pas par `_test` ; migrations via `drizzle-orm/node-postgres/migrator` ; TRUNCATE users CASCADE entre tests, `redis.del limite:*`, vidage du dossier temporaire). `.env.test.example` (brandself_test port 5433, Redis /15). CI job `verification` : services postgres:18 + redis:8, `DATABASE_URL=…/brandself_test`, `REDIS_URL=redis://localhost:6379/15`, `pnpm test --reporter=default --reporter=json --outputFile=test-results/vitest.json` puis `node scripts/verifier-tests-sautes.mjs` (échoue si pending + todo > 0). Les tests HTTP passent par Playwright (un build Nuxt sous Vitest prend 13 à 17 min ici).

## 9. Plan de tâches (périmètres de fichiers disjoints)

| # | Agent | Tâche | Fichiers exclusifs | Dépend de |
|---|---|---|---|---|
| L1a | backend | contrats partagés §4 | `shared/**` sauf `shared/db/**` et `shared/env.ts` ; `package.json` | — |
| L1b | database | schema.ts, migration 0009 + snapshot + journal, alignement déclaratif S3-S6, seed ; test up->down->up | `shared/db/schema.ts`, `server/db/migrations/**`, `server/db/seed.ts` | — |
| L2 | tester (RED) | tests §8 et infrastructure | `tests/**`, `e2e/**`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `scripts/verifier-tests-sautes.mjs`, `.env.test.example` | L1a, L1b |
| L3 | backend (GREEN, 3 cycles max) | §6 : utils, exceptions, services, resources, routes (renommages S2), routes /medias, nuxt.config.ts, .gitignore, auth.config.ts, shared/env.ts ; supprimer les anciens fichiers S2 renommés | `server/**` sauf `server/db/**` ; `shared/env.ts`, `nuxt.config.ts`, `.gitignore` | L2 |
| L3' | frontend | consommer les DTO, titre/pays en codes, wrapper `{moi}`, `data-palette` + 5 palettes CSS, `accept` explicite pour l'upload | `app/**` | L1a |
| L4 | reviewer + regression-checker | lecture seule ; consommateurs : `[username].vue`, `onboarding.vue`, `studio/{index,profil,compte}.vue` | — | L3, L3' |
| L5 | thread principal | PROJECT_STATE, CLAUDE.md §8 (unstorage) | `PROJECT_STATE.md`, `CLAUDE.md` | L4 |

Fin de lot : `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit + intégration, 0 test sauté), `pnpm e2e`, `pnpm build` verts, sortie brute ; nombre de fichiers prévus = nombre traités.

## 10. Points d'attention

Upload : Content-Length avant lecture, pixels limités, double vérification de type, aucun nom de fichier client utilisé, clés construites côté serveur, `nosniff` ; le média est public par UUID (URL-capacité, compromis accepté). Données personnelles : DTO public en liste blanche, aucun token ni IP exposé, journaux sans email/téléphone ; suppression : fichiers effacés après commit (échec -> journal + orphelins, nettoyage S13) ; S10 devra anonymiser les paiements au lieu de supprimer en cascade. CSRF : suffisant en S2 (JSON + SameSite=Lax) ; ajouter une vérification de l'Origin en S13. Révocation de session : le cache cookie de Better Auth est désactivé, une suppression en base suffit. Concurrence : unicité garantie par la base (23505 -> 409). Un mot réservé ajouté après coup ne retire pas une vitrine existante. Pas de cache HTTP sur /api/public en S2 (S12 avec invalidation). Dette S1 : `statusMessage` accentué dans `otp-limiteur` à migrer vers `limiteur.ts`.
Hors périmètre : déconnecter les autres appareils, changement d'email/téléphone, email_hebdo, afficherBadge (S10), SEO éditable (S8/S12), Nginx servant /medias (S13), FK composite (photo_media_id, user_id).
