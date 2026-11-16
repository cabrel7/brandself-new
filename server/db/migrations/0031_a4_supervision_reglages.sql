-- A4 : supervision et registre des réglages (docs/specs/A4-supervision-reglages.md §3, décisions D-A4-04, D-A4-10,
-- D-A4-11, D-A4-15, D-A4-16).
--  1. reglages : registre des réglages d'exploitation modifiés par le superadmin (une ligne par clé modifiée) ;
--  2. capacites_accordees : capacité `mcp` accordée à un compte hors plan (octroi/révocation, une seule active) ;
--  3. envois_codes : journal des envois de codes de connexion, SANS numéro, adresse ni code (D-A4-15) ;
--  4. battements_systeme : dernier instant connu d'un événement d'exploitation (sauvegarde, D-A4-16) ;
--  5. generations_ia : motif de repli `ia_coupee` ajouté au CHECK (D-A4-10, interrupteur `ia.active`).
-- Tables, colonnes, index, contraintes et snapshot (meta/0031_snapshot.json) générés par drizzle-kit à partir de
-- shared/db/schema.ts ; la forme idempotente (IF NOT EXISTS / DROP IF EXISTS), le NOT VALID + VALIDATE, les clés
-- étrangères gardées et le bloc ROLLBACK sont ajoutés à la main. Les noms de contraintes et d'index sont ceux de
-- drizzle-kit : un second `db:generate` doit répondre « No schema changes ».
-- ÉCART DE LA SPEC §3 (voir rapport) : le bloc DO de la spec supprimait TOUTE contrainte de generations_ia dont la
-- définition contient « motif_repli ». Or `generations_ia_motif_coherence_check` ((statut = 'repli') = (motif_repli
-- IS NOT NULL)) la contient aussi : elle aurait été supprimée sans être recréée (un repli sans motif redevenait
-- possible). La contrainte des motifs s'appelle `generations_ia_motif_check` (migration 0021, et non
-- `generations_ia_motif_repli_check` : nom absent de la base et de schema.ts, donc dérive garantie) ; elle est
-- remplacée par son nom, et seule elle. Sa liste précédente est celle de 0021 (« quota_atteint » compris), pas de 0027.
-- Verrous : les quatre tables sont NEUVES et vides (aucun backfill, aucun NOT NULL ajouté à une table existante).
-- `generations_ia_motif_check` est ÉLARGIE : toute ligne existante la satisfait ; elle est posée NOT VALID puis
-- validée (balayage en SHARE UPDATE EXCLUSIVE, sans bloquer les écritures). Limite : drizzle-kit migrate enveloppe
-- tout dans UNE transaction ; CREATE INDEX CONCURRENTLY y est impossible (les deux index portent sur des tables
-- vides, sans conséquence) et le verrou ACCESS EXCLUSIVE du DROP/ADD CONSTRAINT de `generations_ia` dure jusqu'au
-- COMMIT : acceptable (table purgée à 30 jours, DDL de quelques millisecondes) ; à jouer hors pic de trafic.
-- Idempotent : rejouable sans erreur ni perte (aucune table existante n'est recréée ni vidée ; les clés étrangères
-- ne sont ajoutées que si elles manquent).
-- Isolation : pas de tenant ici. `capacites_accordees.user_id` ON DELETE CASCADE (la capacité suit le compte) ;
-- `capacites_accordees.accorde_par` et `reglages.modifie_par` ON DELETE RESTRICT (un administrateur auteur d'une
-- écriture ne se supprime pas, comme `journal_admin`). Ces deux colonnes n'ont pas d'index : tables de quelques
-- dizaines de lignes au plus, aucune requête applicative ne filtre dessus.
-- Les listes (canaux, statuts, capacités) et le format des clés sont recopiés en dur ; leur source côté application
-- est shared/reglages.ts, shared/plans.ts (CAPACITES_PAYANTES) et shared/ia.ts (MOTIFS_REPLI). Garder synchronisées.
-- `envois_codes.id` est un identifiant GENERATED ALWAYS (aucune écriture explicite possible) ; la table ne porte
-- aucune donnée personnelle : seuls canal, pays (indicatif résolu), statut, tentative et un code d'erreur court.

-- 1. Registre des réglages (une ligne par clé modifiée ; pas de ligne = valeur du code ou repli restrictif).
CREATE TABLE IF NOT EXISTS "reglages" (
	"cle" text PRIMARY KEY NOT NULL,
	"valeur" jsonb NOT NULL,
	"modifie_par" text NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reglages_cle_check" CHECK ("reglages"."cle" ~ '^[a-z][a-z0-9_.]{2,63}$'),
	CONSTRAINT "reglages_valeur_check" CHECK (jsonb_typeof("reglages"."valeur") IN ('number','boolean','string'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reglages_modifie_par_users_id_fk' AND conrelid = '"reglages"'::regclass) THEN
    ALTER TABLE "reglages" ADD CONSTRAINT "reglages_modifie_par_users_id_fk" FOREIGN KEY ("modifie_par") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
    ALTER TABLE "reglages" VALIDATE CONSTRAINT "reglages_modifie_par_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint

-- 2. Capacités accordées. Requête réelle de l'index : « ce compte a-t-il la capacité X ? » (consentement MCP et
--    chaque appel d'outil) ; l'unicité partielle garantit au plus UNE capacité active par (compte, capacité).
CREATE TABLE IF NOT EXISTS "capacites_accordees" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"capacite" text NOT NULL,
	"motif" text NOT NULL,
	"accorde_par" text NOT NULL,
	"accorde_le" timestamp with time zone DEFAULT now() NOT NULL,
	"revoque_le" timestamp with time zone,
	CONSTRAINT "capacites_accordees_capacite_check" CHECK ("capacites_accordees"."capacite" IN ('mcp')),
	CONSTRAINT "capacites_accordees_motif_check" CHECK (char_length(btrim("capacites_accordees"."motif")) BETWEEN 5 AND 500),
	CONSTRAINT "capacites_accordees_revocation_check" CHECK ("capacites_accordees"."revoque_le" IS NULL OR "capacites_accordees"."revoque_le" >= "capacites_accordees"."accorde_le")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capacites_accordees_user_id_users_id_fk' AND conrelid = '"capacites_accordees"'::regclass) THEN
    ALTER TABLE "capacites_accordees" ADD CONSTRAINT "capacites_accordees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
    ALTER TABLE "capacites_accordees" VALIDATE CONSTRAINT "capacites_accordees_user_id_users_id_fk";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capacites_accordees_accorde_par_users_id_fk' AND conrelid = '"capacites_accordees"'::regclass) THEN
    ALTER TABLE "capacites_accordees" ADD CONSTRAINT "capacites_accordees_accorde_par_users_id_fk" FOREIGN KEY ("accorde_par") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
    ALTER TABLE "capacites_accordees" VALIDATE CONSTRAINT "capacites_accordees_accorde_par_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capacites_accordees_actives_unique" ON "capacites_accordees" USING btree ("user_id","capacite") WHERE "capacites_accordees"."revoque_le" IS NULL;--> statement-breakpoint

-- 3. Envois de codes de connexion : aucune colonne libre ni identifiante. Requêtes réelles de l'index : agrégat des
--    envois par canal et pays sur une fenêtre de temps (écran « Envois »), et purge à 90 jours (cree_le en tête).
CREATE TABLE IF NOT EXISTS "envois_codes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "envois_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"canal" text NOT NULL,
	"pays" text,
	"statut" text NOT NULL,
	"tentative" smallint NOT NULL,
	"code_erreur" text,
	CONSTRAINT "envois_codes_canal_check" CHECK ("envois_codes"."canal" IN ('sms','email','whatsapp')),
	CONSTRAINT "envois_codes_pays_check" CHECK ("envois_codes"."pays" IS NULL OR "envois_codes"."pays" ~ '^[A-Z]{2}$'),
	CONSTRAINT "envois_codes_statut_check" CHECK ("envois_codes"."statut" IN ('envoye','echec')),
	CONSTRAINT "envois_codes_tentative_check" CHECK ("envois_codes"."tentative" BETWEEN 1 AND 3),
	CONSTRAINT "envois_codes_code_erreur_check" CHECK ("envois_codes"."code_erreur" IS NULL OR char_length("envois_codes"."code_erreur") <= 40)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "envois_codes_cree_le_idx" ON "envois_codes" USING btree ("cree_le","canal","pays");--> statement-breakpoint

-- 4. Battements du système (un instant par clé ; absent = « inconnu », jamais « bon »).
CREATE TABLE IF NOT EXISTS "battements_systeme" (
	"cle" text PRIMARY KEY NOT NULL,
	"horodatage" timestamp with time zone NOT NULL,
	"ecrit_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battements_systeme_cle_check" CHECK ("battements_systeme"."cle" ~ '^[a-z_]{3,40}$')
);
--> statement-breakpoint

-- 5. Motif de repli `ia_coupee` (interrupteur `ia.active`, D-A4-10). Remplace UNIQUEMENT generations_ia_motif_check
--    (liste de 0021 + ia_coupee) ; generations_ia_motif_coherence_check n'est pas touchée.
ALTER TABLE "generations_ia" DROP CONSTRAINT IF EXISTS "generations_ia_motif_check";--> statement-breakpoint
ALTER TABLE "generations_ia" ADD CONSTRAINT "generations_ia_motif_check" CHECK ("generations_ia"."motif_repli" IS NULL OR "generations_ia"."motif_repli" IN (
        'echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur',
        'sans_prompt','file_indisponible','limiteur_indisponible','plafond_global','quota_atteint','ia_coupee')) NOT VALID;--> statement-breakpoint
ALTER TABLE "generations_ia" VALIDATE CONSTRAINT "generations_ia_motif_check";

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- PERTE : les réglages modifiés par le superadmin (les valeurs du code reprennent aussitôt), les capacités `mcp`
-- accordées (les comptes pilotes perdent l'accès MCP : exporter `capacites_accordees` avant), le journal des
-- envois de codes et les battements (la sauvegarde redevient « inconnue »). Le motif `ia_coupee` des générations IA
-- est réécrit en `sans_fournisseur` (même statut `repli`, même repli déterministe sans appel fournisseur) AVANT de
-- recréer l'ancienne CHECK de 0021 (sinon 23514). Les entrées `journal_admin` (reglage.modifier, capacite.accorder,
-- …) ne sont JAMAIS supprimées (journal en ajout seul). Ordre : motif, contrainte, tables, puis le journal drizzle
-- (created_at = valeur « when » de l'idx 31 de meta/_journal.json, soit 1794816300573).
-- BEGIN;
-- UPDATE generations_ia SET motif_repli = 'sans_fournisseur' WHERE motif_repli = 'ia_coupee';
-- ALTER TABLE generations_ia DROP CONSTRAINT IF EXISTS generations_ia_motif_check;
-- ALTER TABLE generations_ia ADD CONSTRAINT generations_ia_motif_check CHECK (motif_repli IS NULL OR motif_repli IN ('echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur','sans_prompt','file_indisponible','limiteur_indisponible','plafond_global','quota_atteint'));
-- DROP TABLE IF EXISTS battements_systeme;
-- DROP TABLE IF EXISTS envois_codes;
-- DROP TABLE IF EXISTS capacites_accordees;
-- DROP TABLE IF EXISTS reglages;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794816300573; -- when de l'idx 31 de meta/_journal.json
-- COMMIT;
