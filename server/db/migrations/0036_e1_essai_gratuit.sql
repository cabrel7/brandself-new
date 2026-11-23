-- E1 (docs/specs/E1-essai-gratuit.md §3, décisions D2 à D6, D8, D11) : essai gratuit accordé à la création de la vitrine.
--  1. abonnements_origine_check : ('paiement','offert','admin') devient ('paiement','offert','admin','essai') ;
--  2. configuration_versions : catégorie `essai` ajoutée à configuration_versions_categorie_check, nouvelle contrainte
--     configuration_versions_essai_cle_check (la catégorie `essai` n'a qu'une clé, `inscription`) et version 1 de départ
--     `e1000000-essai-inscription-1` { actif: true, dureeJours: 14, relanceServicesJour: 2, relanceStatistiquesJour: 7 } ;
--  3. table `essais` (une ligne par essai accordé, elle SURVIT au compte : `user_id` ON DELETE SET NULL, `converti_le`
--     conservé pour le compteur de conversions) + déclencheur `essais_proteger` (ligne immuable : seuls `user_id` -> NULL
--     et `converti_le` NULL -> date passent ; DELETE et tout autre UPDATE = 42501) ;
--  4. table `essais_empreintes` (marqueur anti-abus « un essai par personne » : HMAC-SHA256 en hexadécimal, sans donnée en
--     clair, sans clé étrangère vers `users` ; clé primaire = attribution atomique, FK `essai_id` ON DELETE RESTRICT) + déclencheur
--     `essais_empreintes_proteger` (ligne immuable : tout UPDATE qui change une valeur = 42501 ; tout DELETE = 42501 SAUF dans le
--     contexte de la purge ci-dessous ; sans lui, un DELETE ou un changement de `essai_id` rouvrirait l'essai à la personne) +
--     fonction `essais_empreintes_purger(avant timestamptz)` : SEUL chemin de suppression, conservation 24 mois (décision produit,
--     voir la décision (e)) ;
--  5. outbox : `abonnement_essai_services` (jour 2) et `abonnement_essai_statistiques` (jour 7) ajoutés à
--     emails_transactionnels_type_check ET à emails_transactionnels_occurrence_requise_check (occurrence `ESSAI:<fin ISO>`,
--     30 caractères pour une date au format ISO avec millisecondes : sous la limite de 32 de emails_transactionnels_occurrence_check
--     et conforme à `^[0-9A-Z:.-]*$`), ainsi que `abonnement_essai_constat` (constat que l'essai est terminé : e-mail de SERVICE,
--     catégorie `transactionnel`, même occurrence `ESSAI:<fin ISO>`, ajouté aux deux mêmes contraintes, absent de
--     categorie_type_check). entite_coherence_check n'change pas : `abonnement_%` est déjà admis pour l'entité
--     `abonnement`. En revanche emails_transactionnels_categorie_type_check CHANGE : les deux relances sont `relationnel`
--     (décision de Cabrel : préférence `email_hebdo` et lien de désabonnement), or la contrainte d'avant liait la catégorie
--     `relationnel` au seul type `utilisateur_resume_hebdo` (`(type = 'utilisateur_resume_hebdo') = (categorie = 'relationnel')`) :
--     elle devient `(type IN ('utilisateur_resume_hebdo','abonnement_essai_services','abonnement_essai_statistiques')) =
--     (categorie = 'relationnel')` (`abonnement_essai_constat` n'y figure pas : il reste `transactionnel`). Conséquence à connaître côté service : le plafond « un e-mail relationnel par semaine »
--     s'appuie sur l'index emails_transactionnels_relationnel_idx (entite_id, created_at) ; une ligne d'essai porte l'entité
--     `abonnement` (entite_id = identifiant de l'abonnement), pas l'identifiant du compte du résumé : le service doit en tenir
--     compte s'il veut que les deux familles comptent dans le même plafond.
-- Fichier drizzle-kit (snapshot meta/0036_snapshot.json et journal générés à partir de shared/db/schema.ts ; les noms de
-- tables, contraintes et index sont ceux de drizzle-kit : un second `db:generate` doit répondre « No schema changes »). La
-- forme idempotente (IF [NOT] EXISTS, NOT VALID + VALIDATE, clés étrangères gardées, données avec ON CONFLICT), les
-- déclencheurs et le bloc ROLLBACK sont ajoutés à la main. Listes recopiées à l'identique de shared/db/schema.ts (liste complète
-- des 17 types précédents de 0020, 0021 et 0029, plus les trois nouveaux = 20) ; sources côté application : shared/jobs.ts
-- (TRANSACTIONAL_EMAIL_TYPES), shared/admin-a2.ts (ABONNEMENT_ORIGINES), shared/admin.ts (catégories de version), shared/essai.ts.
-- Garder synchronisées.
-- Décisions de structure :
--  (a) Unicité de `essais.user_id` : index unique PARTIEL (`WHERE user_id IS NOT NULL`, comme dans la spec). Une ligne
--      détachée (compte supprimé) ne bloque rien. Pour un `ON CONFLICT` sur cet index, le prédicat doit être répété :
--      `ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO NOTHING`.
--  (b) Index `essais_debut_le_idx` : requête réelle de `statistiquesEssais(now, jours)` (essais accordés sur 30 jours).
--      Aucun index sur `essais_empreintes.essai_id` : la FK n'est parcourue qu'à la suppression d'un essai, qui est interdite.
--  (c) `essais.version_id` : identifiant de la version appliquée OU `code` (repli sur ESSAI_DEFAUT, D3) ; sans clé étrangère
--      (`code` n'est pas une ligne de configuration_versions, et la version survit de toute façon, ajout seul).
--  (d) PAS de déclencheur BEFORE TRUNCATE sur `essais` : le nettoyage des tests d'intégration (tests/integration/setup.ts :
--      `TRUNCATE users ... CASCADE`) atteint `essais` puis `essais_empreintes` par les clés étrangères ; un garde-fou sur le
--      vidage ferait échouer toute la suite. Le TRUNCATE n'existe dans aucun chemin applicatif ; le propriétaire de la base
--      peut de toute façon contourner un déclencheur. À ajouter (avec la même dispense dans setup.ts que pour
--      `journal_admin`) si la protection contre le vidage devient une exigence.
--  (e) `essais_empreintes` est immuable (déclencheur `essais_empreintes_proteger`, même erreur 42501 que `essais_proteger`) :
--      sans lui, un DELETE ou un UPDATE de `essai_id` rouvrirait un essai déjà consommé. La FK vers `essais` ne gêne pas le
--      déclencheur : `essais` n'est jamais supprimé, la suppression d'un compte ne fait que passer `essais.user_id` à NULL (rien
--      ne touche `essais_empreintes`), et le TRUNCATE de nettoyage des tests (setup.ts) ne déclenche pas les déclencheurs de
--      ligne (même raisonnement que (d)).
--  (f) Conservation des empreintes : 24 mois (décision produit). Seul chemin de suppression : `essais_empreintes_purger(avant)`,
--      SECURITY DEFINER (search_path = public, pg_temp), qui REFUSE (42501) un `avant` NULL ou plus récent que
--      now() - interval '24 months', pose `essais.purge_empreintes` = 'on' par set_config(..., true) (local à la transaction,
--      remis à '' juste après), supprime les empreintes `cree_le < avant` et retourne le nombre de lignes supprimées. Le déclencheur
--      lit ce réglage et n'autorise le DELETE que s'il vaut 'on' ET que la ligne a plus de 24 mois : un réglage falsifié par une
--      session qui n'appelle pas la fonction n'ouvre donc que ce que la purge autorise déjà (jamais une empreinte récente). Le
--      déclencheur refuse toujours tout UPDATE, et `essais_proteger` ignore ce réglage (les essais ne sont JAMAIS supprimés : la purge
--      ne touche que les empreintes, la ligne `essais` et son `converti_le` restent). La durée 24 mois est écrite à deux endroits SQL
--      (fonction et déclencheur) : les modifier ensemble. EXECUTE : le projet n'a qu'UN rôle de base de données (propriétaire,
--      aussi celui de l'application ; rôle séparé prévu en S13, docs/exploitation-admin.md) ; la migration retire donc EXECUTE à PUBLIC
--      (REVOKE ... FROM PUBLIC) et ne l'accorde à personne d'autre : tout rôle créé plus tard n'a aucun droit tant qu'on ne lui
--      fait pas `GRANT EXECUTE ON FUNCTION essais_empreintes_purger(timestamptz) TO <rôle du job de purge>`. Tant qu'il n'y a qu'un rôle,
--      cette limite n'en est pas une pour l'application : le garde-fou réel est le seuil de 24 mois, dans la fonction ET le déclencheur.
--      Aucun appelant applicatif n'existe dans cette migration (le job de purge est hors périmètre).
-- Verrous : deux tables NEUVES (aucun backfill) ; seuls les DROP/ADD CONSTRAINT touchent `abonnements`,
-- `configuration_versions` et `emails_transactionnels`. drizzle-kit migrate enveloppe tout dans UNE transaction : le DROP
-- CONSTRAINT prend ACCESS EXCLUSIVE jusqu'au COMMIT, donc le VALIDATE (scan de la table) se fait sous ce verrou ; le NOT VALID
-- + VALIDATE ne raccourcit rien ici (il reste utile si l'on joue le fichier à la main, hors transaction). Acceptable : les trois
-- tables sont petites (outbox purgée par le job notifications-purger, abonnements = un par compte payant, catalogue = quelques
-- lignes) ; à jouer hors pic. CREATE INDEX CONCURRENTLY est impossible dans la transaction de migrate, et inutile : les deux
-- index portent sur une table neuve et vide. Aucun NOT NULL ajouté à une table existante.
-- Isolation : `essais` et `essais_empreintes` sont adressées par `user_id` (jamais exposées à un autre compte) ; elles ne sont
-- lues que par les services serveur, toujours scopées par l'identifiant du compte authentifié ; aucune donnée personnelle
-- n'y est stockée (HMAC seulement). Le catalogue `configuration_versions` est GLOBAL (aucun tenant).
-- Idempotent : rejouable sans erreur ni perte. La version 1 est insérée avec ON CONFLICT DO NOTHING (une modification
-- faite ensuite par l'administration n'est jamais écrasée, une v1 déjà remplacée n'est pas recréée) ; les déclencheurs sont
-- recréés (DROP TRIGGER IF EXISTS) ; la clé étrangère de `essais` / `essais_empreintes` ne s'ajoute que si elle manque.

-- 1. Origine d'abonnement `essai` (D2).
ALTER TABLE "abonnements" DROP CONSTRAINT IF EXISTS "abonnements_origine_check";--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_origine_check" CHECK ("abonnements"."origine" IN ('paiement','offert','admin','essai')) NOT VALID;--> statement-breakpoint
ALTER TABLE "abonnements" VALIDATE CONSTRAINT "abonnements_origine_check";--> statement-breakpoint

-- 2. Catégorie de configuration `essai` (D3), clé unique `inscription`, version 1 de départ.
ALTER TABLE "configuration_versions" DROP CONSTRAINT IF EXISTS "configuration_versions_categorie_check";--> statement-breakpoint
ALTER TABLE "configuration_versions" DROP CONSTRAINT IF EXISTS "configuration_versions_essai_cle_check";--> statement-breakpoint
ALTER TABLE "configuration_versions" ADD CONSTRAINT "configuration_versions_categorie_check" CHECK ("configuration_versions"."categorie" IN ('plan','prix','frais','moyens','essai')) NOT VALID;--> statement-breakpoint
ALTER TABLE "configuration_versions" ADD CONSTRAINT "configuration_versions_essai_cle_check" CHECK ("configuration_versions"."categorie" <> 'essai' OR "configuration_versions"."cle" = 'inscription') NOT VALID;--> statement-breakpoint
ALTER TABLE "configuration_versions" VALIDATE CONSTRAINT "configuration_versions_categorie_check";--> statement-breakpoint
ALTER TABLE "configuration_versions" VALIDATE CONSTRAINT "configuration_versions_essai_cle_check";--> statement-breakpoint
-- Valeurs conformes au schéma strict schemaValeursEssai (shared/schemas/admin-versions.ts) : dureeJours 1..90 et
-- 1 <= relanceServicesJour < relanceStatistiquesJour < dureeJours ; le service de lecture ignorerait toute ligne invalide
-- (repli sur ESSAI_DEFAUT, qui vaut cette v1). Format repris de 0032 : id de 8 à 64 caractères, auteur `systeme`, motif de
-- 5 à 500 caractères, effective_a 2000-01-01 (v1 « depuis toujours » : un essai accordé avant la migration n'existe pas).
INSERT INTO "configuration_versions" ("id","categorie","cle","numero","valeurs","statut","effective_a","motif","cree_par") VALUES
 ('e1000000-essai-inscription-1','essai','inscription',1,'{"actif":true,"dureeJours":14,"relanceServicesJour":2,"relanceStatistiquesJour":7}','active','2000-01-01T00:00:00Z','Essai gratuit initial à la création de la vitrine (0036)','systeme')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 3. Essais accordés (D5, D11). Ligne immuable, elle survit au compte.
CREATE TABLE IF NOT EXISTS "essais" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"debut_le" timestamp with time zone NOT NULL,
	"fin_le" timestamp with time zone NOT NULL,
	"duree_jours" integer NOT NULL,
	"version_id" text NOT NULL,
	"converti_le" timestamp with time zone,
	CONSTRAINT "essais_duree_jours_check" CHECK ("essais"."duree_jours" BETWEEN 1 AND 90),
	CONSTRAINT "essais_dates_check" CHECK ("essais"."debut_le" < "essais"."fin_le"),
	CONSTRAINT "essais_converti_le_check" CHECK ("essais"."converti_le" IS NULL OR "essais"."converti_le" >= "essais"."debut_le"),
	CONSTRAINT "essais_version_id_check" CHECK (char_length("essais"."version_id") BETWEEN 1 AND 64)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'essais_user_id_users_id_fk' AND conrelid = 'public.essais'::regclass) THEN
    ALTER TABLE "essais" ADD CONSTRAINT "essais_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;
    ALTER TABLE "essais" VALIDATE CONSTRAINT "essais_user_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "essais_user_id_unique" ON "essais" USING btree ("user_id") WHERE "essais"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "essais_debut_le_idx" ON "essais" USING btree ("debut_le");--> statement-breakpoint

-- Déclencheur de protection : seuls `user_id` -> NULL (suppression du compte, ON DELETE SET NULL) et `converti_le` NULL -> date
-- (une fois, D11) passent. Un UPDATE qui ne change rien passe. Ni DELETE ni remplacement de `user_id` (42501).
CREATE OR REPLACE FUNCTION essais_proteger() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'essais : suppression interdite' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.debut_le, NEW.fin_le, NEW.duree_jours, NEW.version_id)
       IS DISTINCT FROM (OLD.id, OLD.debut_le, OLD.fin_le, OLD.duree_jours, OLD.version_id)
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)
     OR (NEW.converti_le IS DISTINCT FROM OLD.converti_le AND (OLD.converti_le IS NOT NULL OR NEW.converti_le IS NULL)) THEN
    RAISE EXCEPTION 'essais : ligne immuable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS essais_proteger ON "essais";--> statement-breakpoint
CREATE TRIGGER essais_proteger BEFORE UPDATE OR DELETE ON "essais" FOR EACH ROW EXECUTE FUNCTION essais_proteger();--> statement-breakpoint

-- 4. Empreintes anti-abus (D4, D6). La clé primaire rend l'attribution atomique.
CREATE TABLE IF NOT EXISTS "essais_empreintes" (
	"empreinte" text PRIMARY KEY NOT NULL,
	"nature" text NOT NULL,
	"essai_id" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "essais_empreintes_empreinte_check" CHECK ("essais_empreintes"."empreinte" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "essais_empreintes_nature_check" CHECK ("essais_empreintes"."nature" IN ('email','telephone'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'essais_empreintes_essai_id_essais_id_fk' AND conrelid = 'public.essais_empreintes'::regclass) THEN
    ALTER TABLE "essais_empreintes" ADD CONSTRAINT "essais_empreintes_essai_id_essais_id_fk" FOREIGN KEY ("essai_id") REFERENCES "public"."essais"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
    ALTER TABLE "essais_empreintes" VALIDATE CONSTRAINT "essais_empreintes_essai_id_essais_id_fk";
  END IF;
END $$;
--> statement-breakpoint

-- Déclencheur de protection : l'empreinte est un marqueur anti-abus en ajout seul. Pas d'UPDATE qui change une valeur
-- (`essai_id` remplacé = essai rouvert) ; un UPDATE qui ne change rien passe (comme essais_proteger). Pas de DELETE, sauf dans
-- le contexte de essais_empreintes_purger (réglage local `essais.purge_empreintes` = 'on') ET pour une ligne de plus de 24 mois.
-- Même SQLSTATE 42501.
CREATE OR REPLACE FUNCTION essais_empreintes_proteger() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('essais.purge_empreintes', true), '') = 'on' AND OLD.cree_le < now() - interval '24 months' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'essais_empreintes : suppression interdite' USING ERRCODE = '42501';
  END IF;
  IF (NEW.empreinte, NEW.nature, NEW.essai_id, NEW.cree_le) IS DISTINCT FROM (OLD.empreinte, OLD.nature, OLD.essai_id, OLD.cree_le) THEN
    RAISE EXCEPTION 'essais_empreintes : ligne immuable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS essais_empreintes_proteger ON "essais_empreintes";--> statement-breakpoint
CREATE TRIGGER essais_empreintes_proteger BEFORE UPDATE OR DELETE ON "essais_empreintes" FOR EACH ROW EXECUTE FUNCTION essais_empreintes_proteger();--> statement-breakpoint

-- Purge des empreintes de plus de `avant` (conservation minimale 24 mois). Retourne le nombre de lignes supprimées. Le réglage
-- est local à la transaction (set_config(..., true)) et remis à '' dès le DELETE fait. Seule l'empreinte part : jamais `essais`.
CREATE OR REPLACE FUNCTION essais_empreintes_purger(avant timestamptz) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  supprimees integer;
BEGIN
  IF avant IS NULL OR avant > now() - interval '24 months' THEN
    RAISE EXCEPTION 'essais_empreintes_purger : conservation minimale de 24 mois (avant doit etre au plus now() - 24 mois)' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('essais.purge_empreintes', 'on', true);
  DELETE FROM essais_empreintes WHERE cree_le < avant;
  GET DIAGNOSTICS supprimees = ROW_COUNT;
  PERFORM set_config('essais.purge_empreintes', '', true);
  RETURN supprimees;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION essais_empreintes_purger(timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 5. Outbox : les trois e-mails de l'essai (D8). Liste COMPLÈTE : les 17 types existants (0016, 0017, 0020, 0021, 0029) + 3.
--    Les deux relances (jour 2, jour 7) sont `relationnel` : la liaison type <-> catégorie `relationnel` (0020) leur est élargie.
--    `abonnement_essai_constat` (essai terminé) est de service, `transactionnel` : il n'entre pas dans cette liaison.
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT IF EXISTS "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT IF EXISTS "emails_transactionnels_occurrence_requise_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT IF EXISTS "emails_transactionnels_categorie_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("emails_transactionnels"."type" IN (
        'reservation_professionnel_nouvelle',
        'reservation_visiteur_recue',
        'reservation_visiteur_confirmee',
        'reservation_visiteur_annulee',
        'reservation_visiteur_refusee',
        'demande_professionnel_nouvelle',
        'demande_visiteur_recue',
        'message_professionnel_nouvelle',
        'reservation_visiteur_rappel',
        'utilisateur_resume_hebdo',
        'utilisateur_rappel_journee',
        'abonnement_rappel',
        'paiement_confirme',
        'utilisateur_suspendu',
        'utilisateur_reactive',
        'utilisateur_jours_offerts',
        'utilisateur_depubliee',
        'abonnement_essai_services',
        'abonnement_essai_statistiques',
        'abonnement_essai_constat'
      )) NOT VALID;--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_requise_check" CHECK ("emails_transactionnels"."type" NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel','abonnement_essai_services','abonnement_essai_statistiques','abonnement_essai_constat')
        OR "emails_transactionnels"."occurrence" <> '') NOT VALID;--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_categorie_type_check" CHECK (("emails_transactionnels"."type" IN ('utilisateur_resume_hebdo','abonnement_essai_services','abonnement_essai_statistiques')) = ("emails_transactionnels"."categorie" = 'relationnel')) NOT VALID;--> statement-breakpoint
ALTER TABLE "emails_transactionnels" VALIDATE CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" VALIDATE CONSTRAINT "emails_transactionnels_occurrence_requise_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" VALIDATE CONSTRAINT "emails_transactionnels_categorie_type_check";

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- Le garde-fou REFUSE le retour arrière (transaction annulée) si un essai ou une empreinte existe (historique anti-abus et
-- conversions perdus), si un abonnement d'origine `essai` existe (l'ancien CHECK le refuserait) ou si l'administration a créé
-- une version `essai` après le départ : exporter d'abord, puis retirer ce garde-fou sous sa responsabilité. PERTE sinon :
-- les e-mails d'essai dans l'outbox (jour 2, jour 7 et constat de fin, supprimés ; les lignes d'un type retiré refuseraient l'ancien CHECK,
-- et la catégorie `relationnel` d'un type autre que le résumé hebdomadaire aussi) et la v1 de configuration `essai` (le code d'avant E1 ne la lit pas). `configuration_versions` est en ajout seul
-- (déclencheur configuration_versions_proteger : DELETE = 42501) : le retrait de la v1 désactive ce déclencheur le temps du
-- DELETE, puis le réactive. Ordre : garde-fou, e-mails, déclencheurs et fonctions (purge, puis empreintes, puis essais), tables (empreintes avant essais : clé
-- étrangère), v1 retirée, CHECK de la configuration, CHECK de l'origine, CHECK de l'outbox (anciennes listes, NOT VALID puis
-- VALIDATE), puis le journal drizzle (created_at = valeur « when » de l'idx 36 de meta/_journal.json, soit 1795437551334).
-- BEGIN;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM essais) OR EXISTS (SELECT 1 FROM essais_empreintes) OR EXISTS (SELECT 1 FROM abonnements WHERE origine = 'essai') OR EXISTS (SELECT 1 FROM configuration_versions WHERE categorie = 'essai' AND (id <> 'e1000000-essai-inscription-1' OR statut <> 'active' OR cree_par <> 'systeme')) THEN RAISE EXCEPTION 'rollback 0036 refuse : des essais, des empreintes, des abonnements essai ou des versions essai de l''administration existent (exporter puis retirer ce garde-fou)'; END IF; END $$;
-- DELETE FROM emails_transactionnels WHERE type IN ('abonnement_essai_services','abonnement_essai_statistiques','abonnement_essai_constat');
-- DROP FUNCTION IF EXISTS essais_empreintes_purger(timestamptz);
-- DROP TRIGGER IF EXISTS essais_empreintes_proteger ON essais_empreintes;
-- DROP FUNCTION IF EXISTS essais_empreintes_proteger();
-- DROP TRIGGER IF EXISTS essais_proteger ON essais;
-- DROP FUNCTION IF EXISTS essais_proteger();
-- DROP TABLE IF EXISTS essais_empreintes;
-- DROP TABLE IF EXISTS essais;
-- ALTER TABLE configuration_versions DISABLE TRIGGER configuration_versions_proteger;
-- DELETE FROM configuration_versions WHERE categorie = 'essai' AND id = 'e1000000-essai-inscription-1';
-- ALTER TABLE configuration_versions ENABLE TRIGGER configuration_versions_proteger;
-- ALTER TABLE configuration_versions DROP CONSTRAINT IF EXISTS configuration_versions_essai_cle_check;
-- ALTER TABLE configuration_versions DROP CONSTRAINT IF EXISTS configuration_versions_categorie_check;
-- ALTER TABLE configuration_versions ADD CONSTRAINT configuration_versions_categorie_check CHECK (categorie IN ('plan','prix','frais','moyens')) NOT VALID;
-- ALTER TABLE configuration_versions VALIDATE CONSTRAINT configuration_versions_categorie_check;
-- ALTER TABLE abonnements DROP CONSTRAINT IF EXISTS abonnements_origine_check;
-- ALTER TABLE abonnements ADD CONSTRAINT abonnements_origine_check CHECK (origine IN ('paiement','offert','admin')) NOT VALID;
-- ALTER TABLE abonnements VALIDATE CONSTRAINT abonnements_origine_check;
-- ALTER TABLE emails_transactionnels DROP CONSTRAINT IF EXISTS emails_transactionnels_type_check;
-- ALTER TABLE emails_transactionnels DROP CONSTRAINT IF EXISTS emails_transactionnels_occurrence_requise_check;
-- ALTER TABLE emails_transactionnels DROP CONSTRAINT IF EXISTS emails_transactionnels_categorie_type_check;
-- ALTER TABLE emails_transactionnels ADD CONSTRAINT emails_transactionnels_type_check CHECK (type IN ('reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee','reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle','demande_visiteur_recue','message_professionnel_nouvelle','reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel','paiement_confirme','utilisateur_suspendu','utilisateur_reactive','utilisateur_jours_offerts','utilisateur_depubliee')) NOT VALID;
-- ALTER TABLE emails_transactionnels ADD CONSTRAINT emails_transactionnels_occurrence_requise_check CHECK (type NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel') OR occurrence <> '') NOT VALID;
-- ALTER TABLE emails_transactionnels ADD CONSTRAINT emails_transactionnels_categorie_type_check CHECK ((type = 'utilisateur_resume_hebdo') = (categorie = 'relationnel')) NOT VALID;
-- ALTER TABLE emails_transactionnels VALIDATE CONSTRAINT emails_transactionnels_type_check;
-- ALTER TABLE emails_transactionnels VALIDATE CONSTRAINT emails_transactionnels_occurrence_requise_check;
-- ALTER TABLE emails_transactionnels VALIDATE CONSTRAINT emails_transactionnels_categorie_type_check;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795437551334; -- when de l'idx 36 de meta/_journal.json
-- COMMIT;
