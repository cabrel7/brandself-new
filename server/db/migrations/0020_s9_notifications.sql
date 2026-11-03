-- S9 : notifications et rétention (docs/specs/S9-notifications.md §2, décisions #81 à #102).
-- Écrite à la main (meta/0020_snapshot.json est le snapshot COMPLET de shared/db/schema.ts, généré par
-- drizzle-kit dans une copie du dossier ; un second `generate` doit répondre « nothing to migrate »).
-- Contenu :
--   users.email_rappel_jour             : préférence « rendez-vous du jour » (email_hebdo existe déjà).
--   vitrines.etapes_ignorees / partagee_le : prochaine étape ignorée pour toujours, date du premier partage.
--   emails_transactionnels              : l'outbox devient le planificateur unique des envois (`occurrence` =
--     clé d'idempotence métier, `categorie`, statut `annule`, 3 types, entité `utilisateur`), index du plafond
--     relationnel et de la purge.
-- Verrous : ADD COLUMN avec défaut constant = métadonnées seulement (PostgreSQL 11+, aucune réécriture de
-- table). Les DROP/ADD CONSTRAINT, DROP INDEX et CREATE UNIQUE INDEX relisent emails_transactionnels (et
-- vitrines pour le CHECK) sous verrou exclusif, dans la transaction unique de drizzle : il n'existe donc aucun
-- instant sans contrainte ni sans unicité. Ces tables sont petites (l'outbox ne garde que des identifiants,
-- 90 jours au plus) ; CONCURRENTLY est impossible dans la transaction de drizzle, et NOT VALID + VALIDATE
-- n'allège pas le verrou dans une même transaction (même raisonnement que 0019).
-- Aucun backfill : les lignes d'outbox existantes prennent occurrence = '' et categorie = 'transactionnel',
-- ce qui est exactement leur sens (types S7, jamais récurrents). L'index unique recréé ne peut donc pas
-- rencontrer de doublon.
-- Les listes des CHECK sont recopiées en dur ; leur source côté application est shared/jobs.ts
-- (TRANSACTIONAL_EMAIL_TYPES), shared/notifications.ts (EMAIL_STATUTS, EMAIL_CATEGORIES) et shared/vitrine.ts
-- (NEXT_STEPS). Garder synchronisées.
-- COUPLAGE DE DÉPLOIEMENT : l'ancien code d'insertion de l'outbox (`ON CONFLICT (entite_type, entite_id,
-- type)`) ne trouve plus d'index unique correspondant après cette migration (erreur 42P10, la transaction de
-- réservation échouerait). Appliquer la migration ET le code S9 (cible de conflit incluant `occurrence`) dans
-- la même mise en production.

-- Contrôle préalable (CA06) : `desabonnement` devient un mot réservé (route /desabonnement). Si une vitrine
-- porte déjà ce nom, la migration échoue avant toute modification ; il faut alors lui faire changer d'adresse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "vitrines" WHERE "username" = 'desabonnement') THEN
    RAISE EXCEPTION 'username réservé desabonnement déjà utilisé';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "email_rappel_jour" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vitrines" ADD COLUMN "etapes_ignorees" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "vitrines" ADD COLUMN "partagee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_etapes_ignorees_check" CHECK ("vitrines"."etapes_ignorees" <@ ARRAY['photo','service','disponibilites','realisation','partager']::text[]);--> statement-breakpoint

ALTER TABLE "emails_transactionnels" ADD COLUMN "occurrence" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD COLUMN "categorie" text DEFAULT 'transactionnel' NOT NULL;--> statement-breakpoint
DROP INDEX "emails_transactionnels_entite_evenement_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "emails_transactionnels_entite_evenement_unique" ON "emails_transactionnels" USING btree ("entite_type","entite_id","type","occurrence");--> statement-breakpoint
CREATE INDEX "emails_transactionnels_relationnel_idx" ON "emails_transactionnels" USING btree ("entite_id","created_at") WHERE "emails_transactionnels"."categorie" = 'relationnel';--> statement-breakpoint
CREATE INDEX "emails_transactionnels_terminal_idx" ON "emails_transactionnels" USING btree ("updated_at") WHERE "emails_transactionnels"."statut" IN ('envoye','echec','annule');--> statement-breakpoint

ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint
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
        'utilisateur_rappel_journee'
      ));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check" CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande', 'message', 'utilisateur'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%')
        OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%')
        OR ("emails_transactionnels"."entite_type" = 'message' AND "emails_transactionnels"."type" LIKE 'message_%')
        OR ("emails_transactionnels"."entite_type" = 'utilisateur' AND "emails_transactionnels"."type" LIKE 'utilisateur_%'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_statut_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_statut_check" CHECK ("emails_transactionnels"."statut" IN ('en_attente', 'en_cours', 'envoye', 'echec', 'annule'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_categorie_check" CHECK ("emails_transactionnels"."categorie" IN ('transactionnel', 'relationnel'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_categorie_type_check" CHECK (("emails_transactionnels"."type" = 'utilisateur_resume_hebdo') = ("emails_transactionnels"."categorie" = 'relationnel'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_check" CHECK (char_length("emails_transactionnels"."occurrence") <= 32 AND "emails_transactionnels"."occurrence" ~ '^[0-9A-Z:.-]*$');--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_requise_check" CHECK ("emails_transactionnels"."type" NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee')
        OR "emails_transactionnels"."occurrence" <> '');

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans UNE transaction, dans cet ordre.
-- Perte, assumée : (1) toutes les lignes d'outbox des 3 nouveaux types (rappels visiteur, résumés, rendez-vous
-- du jour), TOUTES les lignes au statut `annule` (l'ancien CHECK ne connaît pas ce statut) et toute ligne dont
-- `occurrence` n'est pas vide (aucun code S7 n'en produit ; sans ce DELETE la recréation de l'index unique à
-- trois colonnes pourrait échouer en 23505) ; (2) vitrines.etapes_ignorees et vitrines.partagee_le (les étapes
-- ignorées reviennent) ; (3) users.email_rappel_jour (la préférence retombe au comportement d'avant S9).
-- Aucun e-mail déjà `envoye` d'un type S7 n'est supprimé.
-- ATTENTION : le rollback ÉCHOUE (la transaction est annulée en entier, rien n'est modifié) si une des
-- instructions ci-dessous est rejetée. Cas connus :
--   a) 23514 (check_violation) à l'ADD CONSTRAINT d'une ancienne CHECK : il reste une ligne d'un type ou d'un
--      statut que l'ancienne liste ne connaît pas (le DELETE du début est censé les retirer toutes ; une
--      ligne insérée entre-temps par un worker encore démarré les fait réapparaître : ARRÊTER le worker et
--      l'application avant le rollback) ;
--   b) 23505 (unique_violation) à la recréation de l'index à trois colonnes : deux lignes de même
--      (entite_type, entite_id, type) restent (impossible après le DELETE, sauf insertion concurrente) ;
--   c) la migration doit avoir été appliquée en entier (les noms de contraintes et d'index supprimés doivent
--      exister, sinon 42704).
-- Le code S9 ne fonctionne plus après ce rollback (colonnes manquantes) : redéployer le code antérieur.
-- Vérifier avant : SELECT "type", "statut", "occurrence", count(*) FROM "emails_transactionnels" WHERE "type" IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee') OR "statut" = 'annule' OR "occurrence" <> '' GROUP BY 1, 2, 3;
-- Ne s'applique que si le journal est à l'idx 20 : created_at = valeur « when » de meta/_journal.json (idx 20),
-- soit 1793663851946.
-- BEGIN;
-- DELETE FROM "emails_transactionnels" WHERE "type" IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee') OR "statut" = 'annule' OR "occurrence" <> '';
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_occurrence_requise_check";
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_occurrence_check";
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_categorie_type_check";
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_categorie_check";
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_statut_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_statut_check" CHECK ("emails_transactionnels"."statut" IN ('en_attente', 'en_cours', 'envoye', 'echec'));
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%') OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%') OR ("emails_transactionnels"."entite_type" = 'message' AND "emails_transactionnels"."type" LIKE 'message_%'));
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check" CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande', 'message'));
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("emails_transactionnels"."type" IN ('reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee','reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle','demande_visiteur_recue','message_professionnel_nouvelle'));
-- DROP INDEX "emails_transactionnels_terminal_idx";
-- DROP INDEX "emails_transactionnels_relationnel_idx";
-- DROP INDEX "emails_transactionnels_entite_evenement_unique";
-- CREATE UNIQUE INDEX "emails_transactionnels_entite_evenement_unique" ON "emails_transactionnels" USING btree ("entite_type","entite_id","type");
-- ALTER TABLE "emails_transactionnels" DROP COLUMN "categorie";
-- ALTER TABLE "emails_transactionnels" DROP COLUMN "occurrence";
-- ALTER TABLE "vitrines" DROP CONSTRAINT "vitrines_etapes_ignorees_check";
-- ALTER TABLE "vitrines" DROP COLUMN "partagee_le";
-- ALTER TABLE "vitrines" DROP COLUMN "etapes_ignorees";
-- ALTER TABLE "users" DROP COLUMN "email_rappel_jour";
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793663851946; -- when de l'idx 20 de meta/_journal.json
-- COMMIT;
