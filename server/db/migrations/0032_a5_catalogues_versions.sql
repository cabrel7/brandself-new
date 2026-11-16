-- A5 : catalogues et versions de configuration (docs/specs/A5-catalogues-versions.md §3 et §4, décisions D-A5-01,
-- D-A5-02, D-A5-09, D-A5-10, D-A5-12, D-A5-13).
--  1. devises : codes fixés XAF, EUR, USD et drapeau `actif` ;
--  2. pays : les 30 pays de shared/vitrine.ts (PAYS) avec indicatif, devise par défaut, fuseaux et canaux de connexion ;
--  3. usernames_bloques : noms d'adresse interdits en plus de shared/reserved.ts ;
--  4. configuration_versions : versions en AJOUT SEUL des plans, prix, frais et moyens (v1 reprise du code) ;
--     déclencheur `configuration_versions_proteger` (contenu figé, ni DELETE ni TRUNCATE : 42501) ;
--  5. prompts_ia : colonnes `motif` et `cree_par`, historique renseigné, déclencheur `prompts_ia_figer` (contenu figé,
--     suppression interdite : 42501).
-- Tables, colonnes, index, contraintes et snapshot (meta/0032_snapshot.json) générés par drizzle-kit à partir de
-- shared/db/schema.ts ; la forme idempotente (IF NOT EXISTS / DROP IF EXISTS), le NOT VALID + VALIDATE, la clé
-- étrangère gardée, les données de départ (ON CONFLICT), les déclencheurs et le bloc ROLLBACK sont ajoutés à la
-- main. Les noms de contraintes et d'index sont ceux de drizzle-kit : un second `db:generate` doit répondre
-- « No schema changes ».
-- ÉCARTS DE LA SPEC §4 (voir rapport) :
--  (a) pays_fuseaux_check : `cardinality("fuseaux") >= 1` seul laisse passer ARRAY[NULL] et ARRAY[''] (un élément NULL
--      ou vide n'est pas un fuseau) ; refusés ici par array_position(..., NULL) et array_position(..., '').
--  (b) prompts_ia_motif_check et prompts_ia_cree_par_check : mêmes bornes que configuration_versions (motif 5 à 500
--      caractères une fois nettoyé, cree_par 64 au plus), NULL admis (historique et lignes écrites sans motif).
--  (c) Fuseaux du Canada et des États-Unis : la spec n'en donnait qu'un (America/Toronto, America/New_York), ce qui
--      interdit un professionnel de Vancouver ou de Los Angeles ; les autres fuseaux principaux sont ajoutés APRÈS le
--      premier (le premier reste le fuseau de repli, comme dans la spec).
--  (d) Rollback : un garde-fou refuse le retour arrière quand des versions ou des noms bloqués créés après la
--      migration existeraient (historique commercial et sécurité perdus sans copie).
-- Verrous : les quatre tables sont NEUVES (aucun backfill de grosse table). `prompts_ia` reçoit deux colonnes NULLABLES
-- sans défaut (métadonnées seules, aucune réécriture) ; le « backfill » du motif ne touche que quelques lignes
-- (prompts historiques) ; les CHECK sont posés NOT VALID puis validés (SHARE UPDATE EXCLUSIVE, sans bloquer les
-- écritures). Aucun NOT NULL ajouté à une table existante. Limite : drizzle-kit migrate enveloppe tout dans UNE
-- transaction ; CREATE INDEX CONCURRENTLY y est impossible (les deux index portent sur une table neuve et vide) et les
-- verrous du DDL durent jusqu'au COMMIT : acceptable (prompts_ia compte une poignée de lignes) ; à jouer hors pic.
-- Idempotent : rejouable sans erreur ni perte. Les données de départ sont insérées avec ON CONFLICT DO NOTHING (une
-- modification faite ensuite par l'administration n'est jamais écrasée, une v1 déjà remplacée n'est pas recréée) ;
-- la clé étrangère ne s'ajoute que si elle manque ; les déclencheurs sont recréés (DROP TRIGGER IF EXISTS).
-- Isolation : aucun tenant, ces catalogues sont GLOBAUX et ne portent aucune donnée de compte. `vitrines.pays` n'a PAS
-- de clé étrangère vers `pays` (D-A5-10) : aucune vitrine existante ne peut faire échouer la migration.
-- Les listes (devises, catégories, statuts, clés de plan) et les bornes sont recopiées en dur ; leur source côté
-- application est shared/compte.ts (DEVISES), shared/plans.ts (PLAN_IDS), shared/vitrine.ts (PAYS), shared/admin.ts.
-- Garder synchronisées. La v1 de `configuration_versions` reprend EXACTEMENT server/config/plans.ts (PLANS,
-- PRIX_PLANS) et server/config/paiements.ts (FRAIS_PAIEMENT, MOYENS_PAIEMENT actifs) : tests/integration/
-- migration-0032.test.ts l'éprouve ; la grille de prix N'EST PAS validée (la production reste verrouillée).
-- Les déclencheurs ne sont pas contournés par l'application ; seul un superuser (ou session_replication_role =
-- replica) peut les désactiver, comme pour `journal_admin`.

-- 1. Devises gérées. `actif` = ce qu'un compte peut choisir, pas ce qui est payable (D-A5-11).
CREATE TABLE IF NOT EXISTS "devises" (
	"code" text PRIMARY KEY NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devises_code_check" CHECK ("devises"."code" IN ('XAF','EUR','USD'))
);
--> statement-breakpoint
INSERT INTO "devises" ("code","actif") VALUES ('XAF',true),('EUR',true),('USD',true) ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- 2. Pays (créés par migration seulement, D-A5-10). L'indicatif n'est pas unique (+1 : Canada et États-Unis).
--    Devise par défaut XAF PROVISOIRE pour les pays XOF et CEMAC non XAF (R3 de la spec, décision produit en attente).
CREATE TABLE IF NOT EXISTS "pays" (
	"code" text PRIMARY KEY NOT NULL,
	"libelle" text NOT NULL,
	"indicatif" text NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"devise_defaut" text NOT NULL,
	"fuseaux" text[] NOT NULL,
	"canal_sms" boolean DEFAULT true NOT NULL,
	"canal_whatsapp" boolean DEFAULT false NOT NULL,
	"canal_email" boolean DEFAULT true NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pays_code_check" CHECK ("pays"."code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "pays_libelle_check" CHECK (char_length("pays"."libelle") BETWEEN 2 AND 80),
	CONSTRAINT "pays_indicatif_check" CHECK ("pays"."indicatif" ~ '^[1-9][0-9]{0,3}$'),
	CONSTRAINT "pays_fuseaux_check" CHECK (cardinality("pays"."fuseaux") >= 1 AND array_position("pays"."fuseaux", NULL) IS NULL AND array_position("pays"."fuseaux", '') IS NULL)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pays_devise_defaut_devises_code_fk' AND conrelid = '"pays"'::regclass) THEN
    ALTER TABLE "pays" ADD CONSTRAINT "pays_devise_defaut_devises_code_fk" FOREIGN KEY ("devise_defaut") REFERENCES "public"."devises"("code") ON DELETE no action ON UPDATE no action NOT VALID;
    ALTER TABLE "pays" VALIDATE CONSTRAINT "pays_devise_defaut_devises_code_fk";
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "pays" ("code","libelle","indicatif","devise_defaut","fuseaux") VALUES
 ('CM','Cameroun','237','XAF',ARRAY['Africa/Douala']),
 ('SN','Sénégal','221','XAF',ARRAY['Africa/Dakar']),
 ('CI','Côte d’Ivoire','225','XAF',ARRAY['Africa/Abidjan']),
 ('GA','Gabon','241','XAF',ARRAY['Africa/Libreville']),
 ('CG','Congo','242','XAF',ARRAY['Africa/Brazzaville']),
 ('CD','République démocratique du Congo','243','USD',ARRAY['Africa/Kinshasa','Africa/Lubumbashi']),
 ('BJ','Bénin','229','XAF',ARRAY['Africa/Porto-Novo']),
 ('TG','Togo','228','XAF',ARRAY['Africa/Lome']),
 ('BF','Burkina Faso','226','XAF',ARRAY['Africa/Ouagadougou']),
 ('ML','Mali','223','XAF',ARRAY['Africa/Bamako']),
 ('NE','Niger','227','XAF',ARRAY['Africa/Niamey']),
 ('TD','Tchad','235','XAF',ARRAY['Africa/Ndjamena']),
 ('CF','République centrafricaine','236','XAF',ARRAY['Africa/Bangui']),
 ('GN','Guinée','224','USD',ARRAY['Africa/Conakry']),
 ('MG','Madagascar','261','USD',ARRAY['Indian/Antananarivo']),
 ('RW','Rwanda','250','USD',ARRAY['Africa/Kigali']),
 ('BI','Burundi','257','USD',ARRAY['Africa/Bujumbura']),
 ('DJ','Djibouti','253','USD',ARRAY['Africa/Djibouti']),
 ('KM','Comores','269','USD',ARRAY['Indian/Comoro']),
 ('FR','France','33','EUR',ARRAY['Europe/Paris']),
 ('BE','Belgique','32','EUR',ARRAY['Europe/Brussels']),
 ('CH','Suisse','41','EUR',ARRAY['Europe/Zurich']),
 ('CA','Canada','1','USD',ARRAY['America/Toronto','America/Halifax','America/St_Johns','America/Winnipeg','America/Edmonton','America/Vancouver']),
 ('LU','Luxembourg','352','EUR',ARRAY['Europe/Luxembourg']),
 ('MA','Maroc','212','USD',ARRAY['Africa/Casablanca']),
 ('TN','Tunisie','216','USD',ARRAY['Africa/Tunis']),
 ('DZ','Algérie','213','USD',ARRAY['Africa/Algiers']),
 ('US','États-Unis','1','USD',ARRAY['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu']),
 ('GB','Royaume-Uni','44','EUR',ARRAY['Europe/London']),
 ('DE','Allemagne','49','EUR',ARRAY['Europe/Berlin'])
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- 3. Noms d'adresse bloqués (en plus de la liste du code). Vide au départ.
CREATE TABLE IF NOT EXISTS "usernames_bloques" (
	"valeur" text PRIMARY KEY NOT NULL,
	"motif" text NOT NULL,
	"cree_par" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usernames_bloques_valeur_check" CHECK ("usernames_bloques"."valeur" ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
	CONSTRAINT "usernames_bloques_motif_check" CHECK (char_length(btrim("usernames_bloques"."motif")) BETWEEN 5 AND 200),
	CONSTRAINT "usernames_bloques_cree_par_check" CHECK (char_length("usernames_bloques"."cree_par") <= 64)
);
--> statement-breakpoint

-- 4. Versions de configuration (plan, prix, frais, moyens), en ajout seul.
--    Requêtes réelles des deux index : lireVersionActive(categorie, cle) (chemin chaud, cache 5 s) et balayage du job
--    `versions-appliquer` (programmées échues, toutes les 60 s) ; ils portent aussi l'unicité d'une active et d'une
--    programmée par (categorie, cle). L'historique d'une clé est servi par l'unique (categorie, cle, numero).
CREATE TABLE IF NOT EXISTS "configuration_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"categorie" text NOT NULL,
	"cle" text NOT NULL,
	"numero" integer NOT NULL,
	"valeurs" jsonb NOT NULL,
	"statut" text NOT NULL,
	"effective_a" timestamp with time zone,
	"validee_le" timestamp with time zone,
	"motif" text NOT NULL,
	"cree_par" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuration_versions_numero_unique" UNIQUE("categorie","cle","numero"),
	CONSTRAINT "configuration_versions_id_check" CHECK (char_length("configuration_versions"."id") BETWEEN 8 AND 64),
	CONSTRAINT "configuration_versions_categorie_check" CHECK ("configuration_versions"."categorie" IN ('plan','prix','frais','moyens')),
	CONSTRAINT "configuration_versions_cle_check" CHECK ("configuration_versions"."cle" ~ '^[a-z0-9_:.-]{1,60}$'),
	CONSTRAINT "configuration_versions_numero_check" CHECK ("configuration_versions"."numero" >= 1),
	CONSTRAINT "configuration_versions_valeurs_check" CHECK (jsonb_typeof("configuration_versions"."valeurs") = 'object'),
	CONSTRAINT "configuration_versions_statut_check" CHECK ("configuration_versions"."statut" IN ('brouillon','programmee','active','remplacee')),
	CONSTRAINT "configuration_versions_motif_check" CHECK (char_length(btrim("configuration_versions"."motif")) BETWEEN 5 AND 500),
	CONSTRAINT "configuration_versions_cree_par_check" CHECK (char_length("configuration_versions"."cree_par") <= 64),
	CONSTRAINT "configuration_versions_plan_cle_check" CHECK ("configuration_versions"."categorie" <> 'plan' OR "configuration_versions"."cle" IN ('gratuit','payant')),
	CONSTRAINT "configuration_versions_effet_check" CHECK (("configuration_versions"."statut" = 'brouillon') = ("configuration_versions"."effective_a" IS NULL)),
	CONSTRAINT "configuration_versions_validee_check" CHECK ("configuration_versions"."validee_le" IS NULL OR "configuration_versions"."categorie" = 'prix')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "configuration_versions_active_unique" ON "configuration_versions" USING btree ("categorie","cle") WHERE "configuration_versions"."statut" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "configuration_versions_programmee_unique" ON "configuration_versions" USING btree ("categorie","cle") WHERE "configuration_versions"."statut" = 'programmee';--> statement-breakpoint

-- Déclencheur de protection : seuls `statut` et `validee_le` (NULL -> date, une fois) évoluent ; `effective_a` posée
-- n'est plus modifiable ; ni DELETE ni TRUNCATE. Un UPDATE qui ne change rien passe.
CREATE OR REPLACE FUNCTION configuration_versions_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'configuration_versions : suppression interdite' USING ERRCODE = '42501';
  END IF;
  IF (NEW.valeurs, NEW.categorie, NEW.cle, NEW.numero, NEW.motif, NEW.cree_par, NEW.cree_le)
     IS DISTINCT FROM (OLD.valeurs, OLD.categorie, OLD.cle, OLD.numero, OLD.motif, OLD.cree_par, OLD.cree_le)
     OR (OLD.effective_a IS NOT NULL AND NEW.effective_a IS DISTINCT FROM OLD.effective_a)
     OR (OLD.validee_le IS NOT NULL AND NEW.validee_le IS DISTINCT FROM OLD.validee_le) THEN
    RAISE EXCEPTION 'configuration_versions : contenu figé' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS configuration_versions_proteger ON "configuration_versions";--> statement-breakpoint
CREATE TRIGGER configuration_versions_proteger BEFORE UPDATE OR DELETE ON "configuration_versions" FOR EACH ROW EXECUTE FUNCTION configuration_versions_proteger();--> statement-breakpoint
DROP TRIGGER IF EXISTS configuration_versions_sans_vidage ON "configuration_versions";--> statement-breakpoint
CREATE TRIGGER configuration_versions_sans_vidage BEFORE TRUNCATE ON "configuration_versions" FOR EACH STATEMENT EXECUTE FUNCTION configuration_versions_proteger();--> statement-breakpoint

-- 5. prompts_ia : motif et auteur d'une version (NULL pour l'historique de l'auteur), contenu figé après création.
ALTER TABLE "prompts_ia" ADD COLUMN IF NOT EXISTS "motif" text;--> statement-breakpoint
ALTER TABLE "prompts_ia" ADD COLUMN IF NOT EXISTS "cree_par" text;--> statement-breakpoint
UPDATE "prompts_ia" SET "motif" = 'Historique (migrations 0018 et 0027)' WHERE "motif" IS NULL AND "cree_par" IS NULL;--> statement-breakpoint
ALTER TABLE "prompts_ia" DROP CONSTRAINT IF EXISTS "prompts_ia_motif_check";--> statement-breakpoint
ALTER TABLE "prompts_ia" ADD CONSTRAINT "prompts_ia_motif_check" CHECK ("prompts_ia"."motif" IS NULL OR char_length(btrim("prompts_ia"."motif")) BETWEEN 5 AND 500) NOT VALID;--> statement-breakpoint
ALTER TABLE "prompts_ia" VALIDATE CONSTRAINT "prompts_ia_motif_check";--> statement-breakpoint
ALTER TABLE "prompts_ia" DROP CONSTRAINT IF EXISTS "prompts_ia_cree_par_check";--> statement-breakpoint
ALTER TABLE "prompts_ia" ADD CONSTRAINT "prompts_ia_cree_par_check" CHECK ("prompts_ia"."cree_par" IS NULL OR char_length("prompts_ia"."cree_par") <= 64) NOT VALID;--> statement-breakpoint
ALTER TABLE "prompts_ia" VALIDATE CONSTRAINT "prompts_ia_cree_par_check";--> statement-breakpoint

-- Version 1 des valeurs du code. Même contenu que PLANS, PRIX_PLANS, FRAIS_PAIEMENT et MOYENS_PAIEMENT (actifs) ;
-- prix NON validé (validee_le NULL) : la production reste verrouillée comme avant la migration.
INSERT INTO "configuration_versions" ("id","categorie","cle","numero","valeurs","statut","effective_a","motif","cree_par") VALUES
 ('a5000000-plan-gratuit-1','plan','gratuit',1,'{"services":3,"realisations":3,"temoignages":3,"reservationsParMois":10,"generationsIaParMois":3,"badge":true,"statistiquesJours":7,"statistiquesDetails":false,"capacites":{"mcp":false}}','active','2000-01-01T00:00:00Z','Valeurs initiales reprises du code (0032)','systeme'),
 ('a5000000-plan-payant-1','plan','payant',1,'{"services":null,"realisations":null,"temoignages":null,"reservationsParMois":null,"generationsIaParMois":null,"badge":false,"statistiquesJours":90,"statistiquesDetails":true,"capacites":{"mcp":true}}','active','2000-01-01T00:00:00Z','Valeurs initiales reprises du code (0032)','systeme'),
 ('a5000000-prix-payant-1','prix','payant',1,'{"XAF":{"1":5000,"3":13500,"12":48000},"EUR":{"1":800,"3":2200,"12":7700},"USD":{"1":900,"3":2500,"12":8600}}','active','2000-01-01T00:00:00Z','Grille initiale, non validée (0032)','systeme'),
 ('a5000000-frais-kpay-1','frais','kpay:mobile_money',1,'{"tauxPointsBase":500,"supporteur":"marchand"}','active','2000-01-01T00:00:00Z','Frais initiaux reproduits du code (0032)','systeme'),
 ('a5000000-moyens-kpay-1','moyens','kpay',1,'{"actifs":["kpay:MTN_MOMO_CMR","kpay:ORANGE_CMR"]}','active','2000-01-01T00:00:00Z','Moyens actifs initiaux (0032)','systeme')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Déclencheur des prompts : type, version, systeme, gabarit, variables, parametres, schema_sortie et created_at sont
-- figés ; seuls `actif` (activation / retour), `motif` et `cree_par` restent modifiables ; suppression interdite.
CREATE OR REPLACE FUNCTION prompts_ia_figer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'prompts_ia : suppression interdite' USING ERRCODE = '42501'; END IF;
  IF (NEW.type, NEW.version, NEW.systeme, NEW.gabarit, NEW.variables, NEW.parametres, NEW.schema_sortie, NEW.created_at)
     IS DISTINCT FROM (OLD.type, OLD.version, OLD.systeme, OLD.gabarit, OLD.variables, OLD.parametres, OLD.schema_sortie, OLD.created_at)
  THEN RAISE EXCEPTION 'prompts_ia : contenu figé' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prompts_ia_figer ON "prompts_ia";--> statement-breakpoint
CREATE TRIGGER prompts_ia_figer BEFORE UPDATE OR DELETE ON "prompts_ia" FOR EACH ROW EXECUTE FUNCTION prompts_ia_figer();

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- Le premier bloc REFUSE le retour arrière (la transaction est annulée) si des versions de configuration ou des noms
-- bloqués ont été créés par l'administration après la migration : exporter d'abord ces deux tables, puis retirer ce
-- bloc sous sa responsabilité. PERTE sinon : les pays, devises et leurs drapeaux (les listes du code reprennent),
-- les motifs et auteurs des prompts (les prompts créés par l'administration RESTENT, sans motif). Le code d'avant 0032
-- relit les constantes : les versions créées après la migration y sont ignorées. Les déclencheurs sont retirés AVANT
-- leurs fonctions et avant les colonnes. Ordre : garde-fou, déclencheurs, fonctions, colonnes, tables, puis le
-- journal drizzle (created_at = valeur « when » de l'idx 32 de meta/_journal.json, soit 1794816854168).
-- BEGIN;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM configuration_versions WHERE cree_par <> 'systeme') OR EXISTS (SELECT 1 FROM usernames_bloques) THEN RAISE EXCEPTION 'rollback 0032 refuse : des versions ou des noms bloques crees apres la migration existent (exporter puis retirer ce garde-fou)'; END IF; END $$;
-- DROP TRIGGER IF EXISTS prompts_ia_figer ON prompts_ia;
-- DROP FUNCTION IF EXISTS prompts_ia_figer();
-- ALTER TABLE prompts_ia DROP COLUMN IF EXISTS cree_par, DROP COLUMN IF EXISTS motif;
-- DROP TRIGGER IF EXISTS configuration_versions_sans_vidage ON configuration_versions;
-- DROP TRIGGER IF EXISTS configuration_versions_proteger ON configuration_versions;
-- DROP FUNCTION IF EXISTS configuration_versions_proteger();
-- DROP TABLE IF EXISTS configuration_versions;
-- DROP TABLE IF EXISTS usernames_bloques;
-- DROP TABLE IF EXISTS pays;
-- DROP TABLE IF EXISTS devises;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794816854168; -- when de l'idx 32 de meta/_journal.json
-- COMMIT;
