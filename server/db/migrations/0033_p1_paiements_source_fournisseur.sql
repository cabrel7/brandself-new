-- P1 (docs/specs/P1-mercypay.md §3 écart 1, §4.5, critère CA-M16) : un second fournisseur de paiement (Mercy Pay).
--  1. paiements.source : ('kpay','manuel') devient ('fournisseur','manuel'). 'fournisseur' = encaissement passé par un
--     fournisseur de paiement (K-PAY, Mercy Pay, ...), le fournisseur précis restant dans `paiements.fournisseur` ;
--     'manuel' = marquage manuel de l'administration (inchangé). Les lignes 'kpay' existantes deviennent 'fournisseur'.
--  2. paiements_source_coherence_check : `source = 'kpay' OR (cas manuel)` devient `source = 'fournisseur' OR (cas manuel)`.
-- Aucune colonne ajoutée, aucun index, aucune table : `id_fournisseur`, `reference_fournisseur` et leurs index uniques
-- (fournisseur, ...) existent depuis 0021. Aucune vue, aucun déclencheur ni index partiel ne référence paiements.source
-- (vérifié par recherche dans server/db/migrations) ; les lignes 'kpay' de 0032 (configuration_versions : frais et moyens)
-- sont des DONNÉES de catalogue, non touchées ici (elles portent le nom du FOURNISSEUR, pas la source du paiement).
-- Fichier drizzle-kit (snapshot meta/0033_snapshot.json et journal générés à partir de shared/db/schema.ts ; les noms de
-- contraintes sont ceux de drizzle-kit : un second `db:generate` doit répondre « No schema changes »). La forme
-- idempotente (DROP CONSTRAINT IF EXISTS, UPDATE gardé, NOT VALID + VALIDATE) et le bloc ROLLBACK sont ajoutés à la main.
-- ORDRE : les deux anciens CHECK sont retirés AVANT l'UPDATE (l'ancien CHECK refuserait 'fournisseur'), puis les deux
-- nouveaux sont posés NOT VALID (aucun balayage sous verrou exclusif) et validés (SHARE UPDATE EXCLUSIVE, écritures non
-- bloquées). Fenêtre sans CHECK : elle n'existe que DANS la transaction de la migration (drizzle-kit migrate enveloppe
-- tout dans UNE transaction), invisible des autres sessions. Verrous : ALTER ... DROP CONSTRAINT et SET DEFAULT prennent
-- ACCESS EXCLUSIVE jusqu'au COMMIT et l'UPDATE réécrit les lignes K-PAY : acceptable (`paiements` est petite à ce stade,
-- durée de l'ordre de la milliseconde) ; à jouer hors pic de trafic. Si la table devenait grande : UPDATE par lots hors
-- transaction AVANT la migration n'est pas possible tant que l'ancien CHECK existe ; il faudrait alors un CHECK
-- intermédiaire IN ('kpay','fournisseur','manuel'). Non nécessaire ici.
-- Idempotent : rejouable sans erreur ni perte (l'UPDATE ne touche que les lignes encore 'kpay').

ALTER TABLE "paiements" DROP CONSTRAINT IF EXISTS "paiements_source_check";--> statement-breakpoint
ALTER TABLE "paiements" DROP CONSTRAINT IF EXISTS "paiements_source_coherence_check";--> statement-breakpoint
ALTER TABLE "paiements" ALTER COLUMN "source" SET DEFAULT 'fournisseur';--> statement-breakpoint
UPDATE "paiements" SET "source" = 'fournisseur' WHERE "source" = 'kpay';--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_source_check" CHECK ("paiements"."source" IN ('fournisseur','manuel')) NOT VALID;--> statement-breakpoint
ALTER TABLE "paiements" VALIDATE CONSTRAINT "paiements_source_check";--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_source_coherence_check" CHECK (("paiements"."source" = 'manuel') = ("paiements"."fournisseur" = 'manuel')
        AND ("paiements"."source" = 'fournisseur' OR (
          "paiements"."methode" = 'manuel' AND "paiements"."statut" IN ('cree','reussi')
          AND "paiements"."id_fournisseur" IS NULL AND "paiements"."reference_fournisseur" IS NOT NULL
          AND "paiements"."reference_fournisseur" = 'manuel-' || "paiements"."id"
          AND "paiements"."frais_taux_pb" = 0 AND "paiements"."frais_estimes" = 0 AND "paiements"."net_estime" = "paiements"."montant"
          AND "paiements"."code_echec" IS NULL AND "paiements"."initiation_incertaine" = false
        ))) NOT VALID;--> statement-breakpoint
ALTER TABLE "paiements" VALIDATE CONSTRAINT "paiements_source_coherence_check";

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- Le garde-fou ABANDONNE la transaction si une ligne d'un fournisseur AUTRE que 'kpay' existe (par exemple un paiement
-- Mercy Pay) : l'ancien modèle ('kpay' | 'manuel') ne sait pas la représenter sans la mal étiqueter ; dans ce cas
-- restaurer depuis la sauvegarde, ou exporter puis retirer ces lignes sous sa responsabilité. Sans cela, aucune perte :
-- 'fournisseur' redevient 'kpay' (les lignes manuelles ne changent pas). Ordre : garde-fou, retrait des CHECK, UPDATE,
-- défaut, anciens CHECK (NOT VALID puis VALIDATE), puis le journal drizzle (created_at = valeur « when » de l'idx 33 de
-- meta/_journal.json, soit 1794966010914).
-- BEGIN;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM paiements WHERE source = 'fournisseur' AND fournisseur <> 'kpay') THEN RAISE EXCEPTION 'rollback 0033 refuse : des paiements d''un fournisseur autre que kpay existent (restaurer depuis la sauvegarde)'; END IF; END $$;
-- ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_source_check;
-- ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_source_coherence_check;
-- UPDATE paiements SET source = 'kpay' WHERE source = 'fournisseur';
-- ALTER TABLE paiements ALTER COLUMN source SET DEFAULT 'kpay';
-- ALTER TABLE paiements ADD CONSTRAINT paiements_source_check CHECK (source IN ('kpay','manuel')) NOT VALID;
-- ALTER TABLE paiements VALIDATE CONSTRAINT paiements_source_check;
-- ALTER TABLE paiements ADD CONSTRAINT paiements_source_coherence_check CHECK ((source = 'manuel') = (fournisseur = 'manuel') AND (source = 'kpay' OR (methode = 'manuel' AND statut IN ('cree','reussi') AND id_fournisseur IS NULL AND reference_fournisseur IS NOT NULL AND reference_fournisseur = 'manuel-' || id AND frais_taux_pb = 0 AND frais_estimes = 0 AND net_estime = montant AND code_echec IS NULL AND initiation_incertaine = false))) NOT VALID;
-- ALTER TABLE paiements VALIDATE CONSTRAINT paiements_source_coherence_check;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794966010914; -- when de l'idx 33 de meta/_journal.json
-- COMMIT;
