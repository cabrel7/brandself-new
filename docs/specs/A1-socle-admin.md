# Spec A1 — Socle de l'administration (tier critique)

Source : brief `docs/specs/sprints-admin-A1-A5.md` (sections « COMPLÉMENT ADMIN » et « A1 ») + analyse de l'architect du 2026-11-14. Cette spec fait foi pour l'implémentation. Migration : `0028_a1_admin_socle`.

## 1. Décisions (le défaut s'applique ; détail dans docs/JOURNAL_DECISIONS.md)

- **D-A1-01** Pages sous `/admin/**`, API sous `/api/admin/**`, servies seulement sur `ADMIN_HOST`. `/` sur l'hôte admin redirige vers `/admin` (Nginx et middleware de route). Raison : `/connexion` existe déjà côté public (Nuxt route par chemin).
- **D-A1-02** `ADMIN_HOST` = nom d'hôte sans port, obligatoire en production, défaut hors production `admin.localhost`, différent de l'hôte de `NUXT_PUBLIC_SITE_URL`. Exposé dans `runtimeConfig.public.adminHost`.
- **D-A1-03** Plugin `admin()` de Better Auth : rôles `{ user: userAc, superadmin: ac.newRole({ user: [], session: [] }) }` (le superadmin n'a AUCUNE permission du contrôle d'accès du plugin), `adminRoles: ['superadmin']`, `defaultRole: 'user'`, `disabledPaths: ['/admin/impersonate-user', '/admin/stop-impersonating']`, `bannedUserMessage` en français. EN PLUS : `/api/auth/admin/**` renvoie 404 sur les deux hôtes (le plugin ne sert qu'au schéma et au refus de connexion d'un banni ; toutes les écritures passent par nos services, dans une transaction journalisée).
- **D-A1-04** CHECK `incarne_par IS NULL` sur `sessions` : l'impersonation est impossible au niveau de la base.
- **D-A1-05** Sessions admin : colonne `sessions.admin`. Hook `session.create.before` sur l'hôte admin : refuse si le rôle n'est pas superadmin, pose `admin=true` et `expiresAt = now + 8 h`. Hook `session.update.before` : plafonne `expiresAt` à `createdAt + 8 h` (sinon `get-session` rallonge à 30 jours). La garde impose la durée absolue (`createdAt + 8 h`) et supprime la session au-delà. Le cookie garde `Max-Age` 30 j mais ne vaut plus rien côté serveur.
- **D-A1-06** Connexion admin avec les routes email-otp de Better Auth sur l'hôte admin. `sendVerificationOTP` n'envoie rien (en silence, réponse 200 identique) si l'hôte est admin et que l'adresse n'est pas un superadmin. `user.create.before` refuse toute création de compte sur l'hôte admin. Liste blanche des chemins `/api/auth` sur l'hôte admin : `get-session`, `email-otp/send-verification-otp`, `sign-in/email-otp`, `sign-out` ; tout le reste 404 (Google, téléphone, OAuth/MCP, `update-user`, `delete-user`…).
- **D-A1-07** Cookies host-only (pas de `Domain`, pas de `crossSubDomainCookies`). Même nom de cookie, deux jeux distincts par hôte. `trustedOrigins` = `['https://' + ADMIN_HOST]` plus `http://admin.localhost:3000` hors production. PAS de changement de `cookiePrefix` (déconnecterait tout le monde). ATTENTION : le module `@nuxtjs/better-auth` écrase `baseURL` (`node_modules/@nuxtjs/better-auth/dist/runtime/server/utils/auth.js` l.294) : ne PAS compter sur un `baseURL: { allowedHosts }` ; `trustedOrigins` est conservé (l.260).
- **D-A1-08** Réauthentification en TABLE `admin_reauth` (consommée dans la transaction de l'action) : code à 6 chiffres, empreinte HMAC-SHA256 (secret `NUXT_BETTER_AUTH_SECRET`), valable 10 min, 3 essais, lié au triplet `(action, cible_type, cible_id)`, usage unique, limité en débit dans Redis (5 demandes / 15 min / admin), une nouvelle demande pour la même action fait expirer l'ancienne. L'e-mail est envoyé APRÈS le commit (job), adresse lue en base.
- **D-A1-09** Journal : `numero`, `empreinte_precedente`, `empreinte`, `cree_le` posés par le DÉCLENCHEUR sous `pg_advisory_xact_lock` (READ COMMITTED obligatoire). `avant`/`apres` : objet plat, clés `^[a-z_]+$`, valeurs `string ≤ 64 | number | boolean | null` ; une liste noire de clés (`email`, `telephone`, `nom`, `name`, `message`, `contenu`, `motif_visiteur`, `sujet`…) est rejetée par le service.
- **D-A1-10** Second superadmin de secours : recommandé ; `pnpm admin:creer` l'accepte, aucune limite de nombre.
- **D-A1-11** A1 n'a aucune action destructrice : les critères de réauthentification sont prouvés au niveau service et de l'utilitaire `exigerReauth`, sur base réelle. Première preuve HTTP en A2. Aucune route de test en production.
- **D-A1-12** Bandeau : `--admin-bandeau: var(--encre)` et `--sur-admin-bandeau: var(--fond)` (aucune nouvelle couleur) ; `UBanner` avec `:close="false"` si la prop existe, sinon un `div` thémé.
- **D-A1-13** La vue d'ensemble renvoie `{ admin: { nom }, genereLe }` sans compteur (les compteurs arrivent en A2).
- **D-A1-14** La liste d'IP est versionnée seulement en exemple (`admin-ip.conf.exemple`) ; le vrai fichier vit sur le serveur (adresses IP = données personnelles).

## 2. Migration `0028_a1_admin_socle.sql`

```sql
-- 1. users : plugin admin (propriétés Drizzle = noms Better Auth ; colonnes en français)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspendu" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "motif_suspension" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspension_fin" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('user','superadmin')) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" VALIDATE CONSTRAINT "users_role_check";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_privilegie_idx" ON "users" ("role") WHERE "role" <> 'user';--> statement-breakpoint
-- 2. sessions
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "incarne_par" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "admin" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_sans_incarnation_check";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_sans_incarnation_check" CHECK ("incarne_par" IS NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_sans_incarnation_check";--> statement-breakpoint
-- 3. journal_admin
CREATE TABLE IF NOT EXISTS "journal_admin" (
  "id" text PRIMARY KEY,
  "numero" bigint NOT NULL UNIQUE,
  "admin_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" text NOT NULL CHECK ("action" ~ '^[a-z_]+\.[a-z_]+$'),
  "cible_type" text NOT NULL CHECK ("cible_type" ~ '^[a-z_]+$'),
  "cible_id" text CHECK ("cible_id" IS NULL OR char_length("cible_id") <= 64),
  "avant" jsonb, "apres" jsonb,
  "motif" text NOT NULL CHECK (char_length(btrim("motif")) BETWEEN 5 AND 500),
  "ip" text NOT NULL CHECK (char_length("ip") <= 64),
  "cle_idempotence" text CHECK ("cle_idempotence" IS NULL OR char_length("cle_idempotence") BETWEEN 8 AND 128),
  "cree_le" timestamp with time zone NOT NULL DEFAULT now(),
  "empreinte_precedente" text NOT NULL CHECK ("empreinte_precedente" ~ '^[0-9a-f]{64}$'),
  "empreinte" text NOT NULL UNIQUE CHECK ("empreinte" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_admin_cree_le_idx" ON "journal_admin" ("cree_le" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_admin_cible_idx" ON "journal_admin" ("cible_type","cible_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_admin_idempotence_unique" ON "journal_admin" ("admin_id","cle_idempotence") WHERE "cle_idempotence" IS NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_admin_empreinte(p_prec text, p_numero bigint, p_id text, p_admin text, p_action text,
  p_ctype text, p_cid text, p_avant jsonb, p_apres jsonb, p_motif text, p_ip text, p_cle text, p_cree timestamptz)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(p_prec, p_numero, p_id, p_admin, p_action, p_ctype, p_cid,
    p_avant, p_apres, p_motif, p_ip, p_cle,
    to_char(p_cree AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_admin_chainer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dernier record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('journal_admin'));
  SELECT numero, empreinte INTO dernier FROM journal_admin ORDER BY numero DESC LIMIT 1;
  NEW.numero := COALESCE(dernier.numero, 0) + 1;
  NEW.empreinte_precedente := COALESCE(dernier.empreinte, repeat('0', 64));
  NEW.cree_le := now();
  NEW.empreinte := journal_admin_empreinte(NEW.empreinte_precedente, NEW.numero, NEW.id, NEW.admin_id, NEW.action,
    NEW.cible_type, NEW.cible_id, NEW.avant, NEW.apres, NEW.motif, NEW.ip, NEW.cle_idempotence, NEW.cree_le);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_admin_interdire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'journal_admin : ajout seul (% interdit)', TG_OP USING ERRCODE = '42501'; END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_admin_chainer ON journal_admin;--> statement-breakpoint
CREATE TRIGGER journal_admin_chainer BEFORE INSERT ON journal_admin FOR EACH ROW EXECUTE FUNCTION journal_admin_chainer();--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_admin_sans_modif ON journal_admin;--> statement-breakpoint
CREATE TRIGGER journal_admin_sans_modif BEFORE UPDATE OR DELETE ON journal_admin FOR EACH ROW EXECUTE FUNCTION journal_admin_interdire();--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_admin_sans_vidage ON journal_admin;--> statement-breakpoint
CREATE TRIGGER journal_admin_sans_vidage BEFORE TRUNCATE ON journal_admin FOR EACH STATEMENT EXECUTE FUNCTION journal_admin_interdire();--> statement-breakpoint
-- 4. admin_reauth
CREATE TABLE IF NOT EXISTS "admin_reauth" (
  "id" text PRIMARY KEY,
  "admin_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" text NOT NULL, "cible_type" text NOT NULL, "cible_id" text,
  "code_empreinte" text NOT NULL CHECK ("code_empreinte" ~ '^[0-9a-f]{64}$'),
  "essais" smallint NOT NULL DEFAULT 0 CHECK ("essais" BETWEEN 0 AND 3),
  "expire_le" timestamp with time zone NOT NULL,
  "consomme_le" timestamp with time zone,
  "cree_le" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_reauth_ouvert_idx" ON "admin_reauth" ("admin_id","action","cible_type","cible_id") WHERE "consomme_le" IS NULL;
-- ROLLBACK manuel en commentaire, au format de 0027.
```

Côté Drizzle (`shared/db/schema.ts`) : dans `users` : `role`, `banned: boolean('suspendu')`, `banReason: text('motif_suspension')`, `banExpires: timestamp('suspension_fin')` ; dans `sessions` : `impersonatedBy: text('incarne_par')`, `admin: boolean('admin')` ; nouvelles tables `journalAdmin` et `adminReauth`. Un second `pnpm db:generate` doit répondre « No schema changes ». Déclarer aussi `session.additionalFields.admin` (`input: false`) dans `auth.config.ts`.

## 3. Backend

- `server/auth.config.ts` : plugin `admin(...)` (D-A1-03), `trustedOrigins`, `session.additionalFields.admin`, `databaseHooks` (`session.create.before`, `session.update.before`, `user.create.before` — D-A1-05/06), filtre dans `sendVerificationOTP` avec `estHoteAdmin(ctx.request?.headers.get('host'), adminHost)` ; rôle lu via `dbAuth`.
- `server/middleware/00-hote.ts` (passe en premier) : `/api/auth/admin/**` → 404 sur tous les hôtes ; hôte public : `/admin`, `/admin/**`, `/api/admin/**` → 404 ; hôte admin : n'autorise que `/admin/**`, `/api/admin/**`, `/_nuxt/**`, `/__nuxt_error`, la liste blanche `/api/auth`, `/brand/**`, `/favicon.ico` ; tout le reste 404 (y compris `/sw.js`, `/manifest.json`, `/robots.txt`, `/sitemap*`, `/mcp`, `/.well-known`) ; pose `event.context.hoteAdmin` ; en-têtes sur l'hôte admin : `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. L'hôte vient de `req.headers.host` (Nginx pose `Host $host`), JAMAIS de `X-Forwarded-Host`.
- `server/utils/admin.ts` : `requireSuperadmin(event): Promise<ContexteAdmin>` → `{ adminId, nom, sessionId, sessionCreeeLe, ip }` ; toute anomalie = `createError({ statusCode: 404 })` au corps IDENTIQUE (hôte, session, rôle, suspension, `session.admin`, dépassement des 8 h — dans ce dernier cas la session est supprimée).
- `server/services/admin/audit.ts` : `enregistrer(tx, entree): Promise<{ id, numero }>` (Zod strict, liste noire de clés) ; `verifierChaine(executeur): Promise<{ intacte, premiereRupture }>` (recalcul SQL avec `journal_admin_empreinte` et `lag(empreinte) OVER (ORDER BY numero)`).
- `server/services/admin/reauth.ts` : `demanderCode(adminId, { action, cibleType, cibleId })` → `{ expireLe }` (écrit la ligne, met en file `sendAdminReauthEmail` APRÈS le commit, e-mail lu en base) ; `consommer(tx, adminId, { action, cibleType, cibleId, code })` : `UPDATE … SET consomme_le = now() WHERE … AND consomme_le IS NULL AND expire_le > now() AND essais < 3 AND code_empreinte = $h RETURNING id` ; code faux : compteur d'essais incrémenté via `db` (hors transaction) puis `REAUTH_INVALIDE` (403).
- `server/utils/reauth.ts` : `exigerReauth(event, tx, adminId, preuve)` lit l'en-tête `X-Admin-Reauth` ; absent → 403 `REAUTH_REQUISE`.
- `server/services/admin/session.ts` (`lireSessionAdmin`), `server/services/admin/vue-ensemble.ts`, `server/resources/admin.ts` (`toAdminSession`, `toVueEnsemble` : réponse validée par `schema.strict().parse` à partir d'un objet construit champ par champ, jamais de spread).
- Routes minces (`defineApiHandler`, `requireSuperadmin` en premier) : `GET /api/admin/session` → `{ id, nom, email, expireLe }` ; `GET /api/admin/vue-ensemble` → `{ admin: { nom }, genereLe }` ; `POST /api/admin/reauth/code` (corps `{ action, cibleType, cibleId? }`, 202 `{ expireLe }`, 429 si limité) ; `POST /api/admin/deconnexion` → 204 (supprime session et cookie).
- `server/exceptions/http.ts` : messages `REAUTH_REQUISE`, `REAUTH_INVALIDE`, `MOTIF_REQUIS`.
- `worker/` : traitement du job `sendAdminReauthEmail` (gabarit « Code de confirmation d'une action d'administration », libellé de l'action, aucune cible personnelle).
- `scripts/admin-creer.ts` et `scripts/admin-reinitialiser.ts` (lancés par `tsx` comme `db:seed`, `package.json` : `admin:creer`, `admin:reinitialiser`) : creer = crée ou promeut l'adresse (`emailVerified=true`, `role=superadmin`) et journalise `superadmin.creer` (motif « commande serveur », IP `cli`) ; reinitialiser = lève la suspension, remet le rôle, supprime sessions et réauthentifications ouvertes, journalise ; une seule transaction chacun.

## 4. Frontend (`app/**`, composants @nuxt/ui 4.12 uniquement, aucun composant maison)

Composants disponibles : `UDashboardGroup`, `UDashboardSidebar` (v-model:collapsed, resizable, menu glissant mobile), `UDashboardPanel`, `UDashboardNavbar`, `UNavigationMenu`, `UBanner`, `UEmpty`, `UPinInput`, `UForm`, `UFormField`, `UInput`, `UButton`, `UUser`. Pour la suite : `UTable`, `USlideover`, `UModal`, `UPagination`.

- `app/layouts/admin.vue` : bandeau « Administration », barre latérale (Vue d'ensemble, Utilisateurs, Vitrines, Abonnements, Systèmes, Réglages, Journal ; icônes `i-ph-*`), barre du haut (nom de l'admin, Déconnexion).
- `app/middleware/admin.ts` (nommé) : `$fetch('/api/admin/session')` ; 404 → `navigateTo('/admin/connexion')`. `app/middleware/hote.global.ts` : sur l'hôte admin, toute route hors `/admin` part vers `/admin` ; sur l'hôte public, `/admin` → `showError(404)`. `app/composables/useAdminSession.ts`.
- Pages : `admin/index.vue`, `admin/connexion.vue` (e-mail puis code avec `UPinInput`, routes `/api/auth`, sans Google ni téléphone ; message neutre « Si cette adresse est autorisée, un code vient d'être envoyé. »), pages provisoires « Bientôt disponible » (`UEmpty`) : `utilisateurs`, `vitrines`, `abonnements`, `systemes`, `reglages`, `journal`. Chaque page : `definePageMeta({ layout: 'admin', middleware: 'admin' })` sauf la connexion.
- Modifications : `app/app.vue` (`<InstallPrompt v-if="!hoteAdmin" />`), `app/composables/usePwaInstall.ts` (pas d'enregistrement du service worker si `location.hostname === adminHost`), `app/plugins/suivi-visite.client.ts` (sortie immédiate sur l'hôte admin), `app/assets/css/main.css` (`--admin-bandeau`, `--sur-admin-bandeau` et entrées `@theme`).
- Vocabulaire : interface en français, vouvoiement, « vitrine ». Aucune couleur en dur.

## 5. Nginx / exploitation (`deploy/**`, `docs/exploitation-admin.md`)

- `deploy/nginx/admin.conf` : serveur `admin.jesuis.pro` (443 ssl) ; `include /etc/nginx/brandself-admin-ip.conf; deny all;` ; en-têtes `X-Robots-Tag noindex, nofollow`, `Cache-Control no-store`, `X-Frame-Options DENY` ; `location = / { return 302 /admin; }` ; `location /api/auth/admin/ { return 404; }` ; proxy seulement pour `^/(admin|api/admin|api/auth|_nuxt|brand)(/|$)` avec `Host $host`, `X-Forwarded-Proto $scheme`, `X-Forwarded-For $remote_addr`, sans cache ; `location / { return 404; }`.
- `deploy/nginx/admin-ip.conf.exemple`, ajout dans `deploy/nginx/brandself-location.conf` de `location ~ ^/(admin|api/admin|api/auth/admin)(/|$) { return 404; }`, `deploy/verifier-admin.sh` (curl : `jesuis.pro/api/admin/session` 404 ; `jesuis.pro/admin` 404 ; `admin.jesuis.pro/studio` 404 ; IP hors liste 403 ; aucun `Set-Cookie` avec `Domain=` ; `X-Robots-Tag` et `no-store` présents), `docs/exploitation-admin.md` (création, récupération, liste d'IP).

## 6. Critères d'acceptation

- **CA01** non connecté / compte ordinaire / superadmin sur chaque route `/api/admin/**` (hôte admin) : seul le superadmin a 2xx ; les autres 404 au corps identique.
- **CA02** session superadmin valide + `Host: jesuis.pro` sur `/api/admin/session` : 404.
- **CA03** hôte admin : `GET /studio`, `/@dr-cabrel`, `/api/studio/moi`, `/sw.js`, `/manifest.json`, `/mcp`, `/api/auth/sign-in/social` : 404.
- **CA04** tout hôte : `POST /api/auth/admin/impersonate-user` et `/api/auth/admin/set-role` : 404.
- **CA05** adresse non superadmin demandant un code sur l'hôte admin : 200 `{success:true}` et AUCUN job en file (file BullMQ réelle).
- **CA06** code valide d'un compte ordinaire (obtenu sur jesuis.pro) utilisé sur l'hôte admin : 403 et aucune ligne dans `sessions`.
- **CA07** adresse inconnue + code sur l'hôte admin : aucun compte créé dans `users`.
- **CA08** superadmin se connectant sur l'hôte admin : session `admin=true`, `expires_at <= created_at + 8 h`, `Set-Cookie` sans `Domain`.
- **CA09** session admin dont `created_at` remonte à 8 h 01 : `/api/admin/session` = 404 et session supprimée.
- **CA10** `get-session` sur session admin active : `expires_at` reste `<= created_at + 8 h`.
- **CA11** compte `suspendu=true` par code e-mail ou téléphone : 403 `BANNED_USER`, aucune session créée.
- **CA12** cookie d'une session superadmin ouverte sur jesuis.pro présenté sur l'hôte admin : 404 (`admin=false`).
- **CA13** UPDATE, DELETE ou TRUNCATE en SQL sur `journal_admin` : erreur 42501.
- **CA14** action qui écrit son journal puis lève une erreur dans la même transaction : ni l'action ni la ligne de journal ne subsistent.
- **CA15** journal de 3 lignes, 2e altérée (déclencheur désactivé le temps du test) : `verifierChaine` = `{ intacte:false, premiereRupture:2 }`.
- **CA16** 20 insertions simultanées : `numero` de 1 à 20 sans trou, chaîne intacte.
- **CA17** entrée d'audit avec `apres.email` ou valeur > 64 caractères : `enregistrer` lève, rien n'est écrit.
- **CA18** action destructrice : sans code → `REAUTH_REQUISE` ; code valide → passe et `consomme_le` rempli ; même code rejoué → `REAUTH_INVALIDE`.
- **CA19** code demandé pour `(compte.supprimer, user, A)` utilisé pour la cible B : refus.
- **CA20** 3 codes faux puis le bon : refusé ; 6 demandes en 15 min : 429.
- **CA21** deux clés d'idempotence identiques pour un même admin : la seconde insertion est rejetée par l'unicité.
- **CA22** pages `/admin/*` : `X-Robots-Tag: noindex`, `Cache-Control: no-store`, aucun `InstallPrompt`, aucun POST `/vue`, aucune inscription de service worker.
- **CA23** nouvelle route `server/api/admin/x.get.ts` absente du contrat : le test de confidentialité échoue ; idem si un schéma de réponse contient une clé interdite ou n'est pas `.strict()`.
- **CA24** `pnpm admin:creer a@b.c` : `role=superadmin` + ligne `superadmin.creer` ; `admin:reinitialiser` : suspension levée, sessions supprimées, ligne de journal.

## 7. Tests (base de test réelle, aucun mock du journal, des droits ni des déclencheurs)

`tests/unit/admin/hote.test.ts` (estHoteAdmin, classification des chemins), `tests/unit/admin/env-admin.test.ts`, `tests/unit/admin/contrat-confidentialite.test.ts` (parcourt `server/api/admin/**` vs table `CONTRAT`), `tests/integration/admin/journal.test.ts` (CA13–CA17, CA21), `reauth.test.ts` (CA18–CA20), `session-admin.test.ts` (CA06–CA12), `scripts.test.ts` (CA24), `tests/integration/support/admin.ts` (fabrique superadmin + session admin), `e2e/admin-acces.spec.ts` (CA01–CA05, requêtes brutes avec en-tête `Host`), `e2e/admin-surfaces.spec.ts` (CA22), `e2e/helpers/admin.ts`. Playwright : Chromium avec `--host-resolver-rules=MAP admin.localhost 127.0.0.1` dans `playwright.config.ts`. Vérifier que ces fichiers sont lancés dans le workflow de CI (non vérifié).

## 8. Périmètres de fichiers

**Thread principal (avant les agents)** : `shared/admin.ts` (ROLES, SUPERADMIN, ADMIN_SESSION_DUREE_S=28800, ADMIN_REAUTH_{TTL_S:600, ESSAIS:3, LIMITE:5, FENETRE_S:900}, ADMIN_ACTIONS, ADMIN_NAV, CHEMINS_AUTH_ADMIN, `estHoteAdmin(host, adminHost)`, CLES_AUDIT_INTERDITES), `shared/schemas/admin.ts` (DTO Zod stricts), `shared/erreurs.ts` (nouveaux codes), `shared/env.ts` (`ADMIN_HOST`), `nuxt.config.ts` (routeRules `/admin/**` ssr:false + noindex + no-store ; `/api/admin/**` no-store ; `runtimeConfig.public.adminHost`), `shared/jobs.ts` (`sendAdminReauthEmail`).

**Agents** : **database** = `shared/db/schema.ts`, `server/db/migrations/0028_*.sql`, `meta/0028_snapshot.json`, `meta/_journal.json` ; **backend** = `server/**` (hors migrations), `worker/**`, `scripts/admin-*.ts`, `package.json` ; **frontend** = `app/**` ; **devops** = `deploy/**`, `docs/exploitation-admin.md` ; **tester** = `tests/**`, `e2e/**`, `playwright.config.ts`.

## 9. Risques assumés

Cookie admin `Max-Age` 30 j (durée imposée côté serveur) ; le propriétaire de la table peut supprimer le déclencheur (rôle de base séparé en S13) ; verrou consultatif qui sérialise les écritures admin (un seul admin, READ COMMITTED) ; `admin.localhost` et `::1` (tests d'API avec en-tête `Host` sur 127.0.0.1) ; comptes bannis et jetons MCP : révocation en A2 ; code de connexion partagé entre hôtes (même boîte mail, liste d'IP) ; non vérifiés : `disabledPaths`, prop de fermeture de `UBanner`, `ctx` exact de `user.create.before` (`tryGetCurrentAuthEndpointContext` fournit `ctx.request`).
