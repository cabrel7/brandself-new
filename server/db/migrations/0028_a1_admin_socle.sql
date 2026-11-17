-- A1 : socle de l'administration (docs/specs/A1-socle-admin.md §2, décisions D-A1-04, D-A1-05, D-A1-08, D-A1-09).
--  1. users    : champs du plugin admin() de Better Auth (role, suspendu, motif_suspension, suspension_fin) ;
--  2. sessions : incarne_par (toujours NULL : l'impersonation est impossible au niveau de la base) et admin ;
--  3. journal_admin : journal AJOUT SEUL et CHAÎNÉ (numéro, empreinte précédente, empreinte posés par un
--     déclencheur) ; UPDATE, DELETE et TRUNCATE refusés (42501) ;
--  4. admin_reauth : codes de réauthentification (haché, 10 min, 3 essais, usage unique).
-- Tables, colonnes, index, contraintes et snapshot (meta/0028_snapshot.json) générés par drizzle-kit à partir de
-- shared/db/schema.ts ; la forme idempotente (IF NOT EXISTS / DROP IF EXISTS), le NOT VALID + VALIDATE, les
-- fonctions, les déclencheurs et le bloc ROLLBACK sont ajoutés à la main (drizzle-kit ne les génère pas). Les
-- noms de contraintes et d'index sont ceux de drizzle-kit : un second `db:generate` doit répondre
-- « No schema changes ».
-- Verrous : ADD COLUMN avec valeur par défaut CONSTANTE (PostgreSQL 11+) = métadonnées seules, aucune
-- réécriture de `users` ni de `sessions`, aucun backfill nécessaire (toutes les lignes existantes valent
-- role='user', suspendu=false, admin=false, incarne_par NULL). Les CHECK sont posés NOT VALID puis validés
-- (balayage en SHARE UPDATE EXCLUSIVE, sans bloquer les écritures). Limite : drizzle-kit migrate enveloppe tout
-- dans UNE transaction, donc le verrou ACCESS EXCLUSIVE du DROP/ADD CONSTRAINT dure jusqu'au COMMIT ; acceptable
-- (CHECK triviaux, une seule passe sur `users` et `sessions`) ; à jouer hors pic de trafic.
-- Idempotent : rejouable sans erreur ni perte (le journal et les réauthentifications ne sont jamais modifiés).
-- DEUX DÉVIATIONS volontaires par rapport à la spec §2 (voir rapport) : horodatage par clock_timestamp()
-- (pas now()) et refus explicite hors READ COMMITTED dans le déclencheur de chaînage.
-- Les bornes des CHECK (motif 5-500, rôles, forme des actions) sont recopiées en dur ; leur source côté
-- application est shared/admin.ts et shared/schemas/admin.ts. Garder synchronisées.

-- 1. users : plugin admin() (propriétés Drizzle = noms Better Auth ; colonnes en français).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspendu" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "motif_suspension" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspension_fin" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('user','superadmin')) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" VALIDATE CONSTRAINT "users_role_check";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_privilegie_idx" ON "users" USING btree ("role") WHERE "users"."role" <> 'user';--> statement-breakpoint

-- 2. sessions : pas d'incarnation, marqueur de session d'administration.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "incarne_par" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_sans_incarnation_check";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_sans_incarnation_check" CHECK ("sessions"."incarne_par" IS NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_sans_incarnation_check";--> statement-breakpoint

-- 3. journal_admin. Les défauts de numero / empreintes ne sont que des marqueurs : le déclencheur les remplace
-- toujours ; numero = 0 est refusé par journal_admin_numero_check si le déclencheur venait à manquer.
CREATE TABLE IF NOT EXISTS "journal_admin" (
	"id" text PRIMARY KEY NOT NULL,
	"numero" bigint DEFAULT 0 NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"cible_type" text NOT NULL,
	"cible_id" text,
	"avant" jsonb,
	"apres" jsonb,
	"motif" text NOT NULL,
	"ip" text NOT NULL,
	"cle_idempotence" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"empreinte_precedente" text DEFAULT repeat('0', 64) NOT NULL,
	"empreinte" text DEFAULT repeat('0', 64) NOT NULL,
	CONSTRAINT "journal_admin_numero_unique" UNIQUE("numero"),
	CONSTRAINT "journal_admin_empreinte_unique" UNIQUE("empreinte"),
	CONSTRAINT "journal_admin_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "journal_admin_numero_check" CHECK ("journal_admin"."numero" > 0),
	CONSTRAINT "journal_admin_action_check" CHECK ("journal_admin"."action" ~ '^[a-z_]+\.[a-z_]+$'),
	CONSTRAINT "journal_admin_cible_type_check" CHECK ("journal_admin"."cible_type" ~ '^[a-z_]+$'),
	CONSTRAINT "journal_admin_cible_id_check" CHECK ("journal_admin"."cible_id" IS NULL OR char_length("journal_admin"."cible_id") <= 64),
	CONSTRAINT "journal_admin_avant_check" CHECK ("journal_admin"."avant" IS NULL OR jsonb_typeof("journal_admin"."avant") = 'object'),
	CONSTRAINT "journal_admin_apres_check" CHECK ("journal_admin"."apres" IS NULL OR jsonb_typeof("journal_admin"."apres") = 'object'),
	CONSTRAINT "journal_admin_motif_check" CHECK (char_length(btrim("journal_admin"."motif")) BETWEEN 5 AND 500),
	CONSTRAINT "journal_admin_ip_check" CHECK (char_length("journal_admin"."ip") <= 64),
	CONSTRAINT "journal_admin_cle_idempotence_check" CHECK ("journal_admin"."cle_idempotence" IS NULL OR char_length("journal_admin"."cle_idempotence") BETWEEN 8 AND 128),
	CONSTRAINT "journal_admin_empreinte_precedente_check" CHECK ("journal_admin"."empreinte_precedente" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "journal_admin_empreinte_check" CHECK ("journal_admin"."empreinte" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_admin_cree_le_idx" ON "journal_admin" USING btree ("cree_le" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_admin_cible_idx" ON "journal_admin" USING btree ("cible_type","cible_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_admin_admin_id_idx" ON "journal_admin" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_admin_idempotence_unique" ON "journal_admin" USING btree ("admin_id","cle_idempotence") WHERE "journal_admin"."cle_idempotence" IS NOT NULL;--> statement-breakpoint

-- Empreinte d'une ligne : SHA-256 (hex) du tableau JSON [empreinte précédente, numéro, id, admin, action, type et
-- id de la cible, avant, après, motif, ip, clé d'idempotence, date UTC en ISO à la microseconde]. L'horodatage
-- est converti en UTC AVANT to_char : le résultat ne dépend pas du fuseau de la session.
CREATE OR REPLACE FUNCTION journal_admin_empreinte(p_prec text, p_numero bigint, p_id text, p_admin text, p_action text,
  p_ctype text, p_cid text, p_avant jsonb, p_apres jsonb, p_motif text, p_ip text, p_cle text, p_cree timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(p_prec, p_numero, p_id, p_admin, p_action, p_ctype, p_cid,
    p_avant, p_apres, p_motif, p_ip, p_cle,
    to_char(p_cree AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint
-- Chaînage : le verrou consultatif de transaction sérialise les insertions ; sous READ COMMITTED, la lecture du
-- dernier numéro faite APRÈS l'obtention du verrou voit l'insertion validée du détenteur précédent. Sous
-- REPEATABLE READ / SERIALIZABLE l'instantané est antérieur au verrou : refus explicite. L'horodatage est pris
-- sous le verrou (clock_timestamp, pas now()) pour que cree_le croisse avec numero.
CREATE OR REPLACE FUNCTION journal_admin_chainer() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE dernier record;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'journal_admin : niveau d''isolation % interdit (READ COMMITTED requis)', current_setting('transaction_isolation')
      USING ERRCODE = '25000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('journal_admin'));
  SELECT numero, empreinte INTO dernier FROM public.journal_admin ORDER BY numero DESC LIMIT 1;
  NEW.numero := COALESCE(dernier.numero, 0) + 1;
  NEW.empreinte_precedente := COALESCE(dernier.empreinte, repeat('0', 64));
  NEW.cree_le := clock_timestamp();
  NEW.empreinte := journal_admin_empreinte(NEW.empreinte_precedente, NEW.numero, NEW.id, NEW.admin_id, NEW.action,
    NEW.cible_type, NEW.cible_id, NEW.avant, NEW.apres, NEW.motif, NEW.ip, NEW.cle_idempotence, NEW.cree_le);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_admin_interdire() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'journal_admin : ajout seul (% interdit)', TG_OP USING ERRCODE = '42501'; END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_admin_chainer ON journal_admin;--> statement-breakpoint
CREATE TRIGGER journal_admin_chainer BEFORE INSERT ON journal_admin FOR EACH ROW EXECUTE FUNCTION journal_admin_chainer();--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_admin_sans_modif ON journal_admin;--> statement-breakpoint
CREATE TRIGGER journal_admin_sans_modif BEFORE UPDATE OR DELETE ON journal_admin FOR EACH ROW EXECUTE FUNCTION journal_admin_interdire();--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_admin_sans_vidage ON journal_admin;--> statement-breakpoint
CREATE TRIGGER journal_admin_sans_vidage BEFORE TRUNCATE ON journal_admin FOR EACH STATEMENT EXECUTE FUNCTION journal_admin_interdire();--> statement-breakpoint

-- 4. admin_reauth.
CREATE TABLE IF NOT EXISTS "admin_reauth" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"cible_type" text NOT NULL,
	"cible_id" text,
	"code_empreinte" text NOT NULL,
	"essais" smallint DEFAULT 0 NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"consomme_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_reauth_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "admin_reauth_action_check" CHECK ("admin_reauth"."action" ~ '^[a-z_]+\.[a-z_]+$'),
	CONSTRAINT "admin_reauth_cible_type_check" CHECK ("admin_reauth"."cible_type" ~ '^[a-z_]+$'),
	CONSTRAINT "admin_reauth_cible_id_check" CHECK ("admin_reauth"."cible_id" IS NULL OR char_length("admin_reauth"."cible_id") <= 64),
	CONSTRAINT "admin_reauth_code_empreinte_check" CHECK ("admin_reauth"."code_empreinte" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admin_reauth_essais_check" CHECK ("admin_reauth"."essais" BETWEEN 0 AND 3)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_reauth_ouvert_idx" ON "admin_reauth" USING btree ("admin_id","action","cible_type","cible_id") WHERE "admin_reauth"."consomme_le" IS NULL;

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- PERTE : tout le journal d'administration (le chaînage empêche de le restaurer partiellement : exporter
-- d'abord si besoin), les réauthentifications, et les colonnes role/suspendu/motif_suspension/suspension_fin
-- (users) et incarne_par/admin (sessions) : les comptes superadmin redeviennent des comptes ordinaires
-- (la colonne role disparaît) et les suspensions sont perdues. Ordre : tables (leurs déclencheurs et index
-- partent avec), fonctions (après les tables, qui les référencent), puis contraintes, index et colonnes, puis le
-- journal drizzle (created_at = valeur « when » de l'idx 28 de meta/_journal.json, soit 1794629004598).
-- BEGIN;
-- DROP TABLE IF EXISTS admin_reauth;
-- DROP TABLE IF EXISTS journal_admin;
-- DROP FUNCTION IF EXISTS journal_admin_chainer();
-- DROP FUNCTION IF EXISTS journal_admin_interdire();
-- DROP FUNCTION IF EXISTS journal_admin_empreinte(text, bigint, text, text, text, text, text, jsonb, jsonb, text, text, text, timestamptz);
-- ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_sans_incarnation_check;
-- ALTER TABLE sessions DROP COLUMN IF EXISTS admin, DROP COLUMN IF EXISTS incarne_par;
-- DROP INDEX IF EXISTS users_role_privilegie_idx;
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
-- ALTER TABLE users DROP COLUMN IF EXISTS suspension_fin, DROP COLUMN IF EXISTS motif_suspension, DROP COLUMN IF EXISTS suspendu, DROP COLUMN IF EXISTS role;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794629004598; -- when de l'idx 28 de meta/_journal.json
-- COMMIT;
