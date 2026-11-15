-- A3 : abonnements, paiements et revenus (docs/specs/A3-abonnements-paiements.md §3, décisions D-A3-01, D-A3-03,
-- D-A3-05).
--  1. paiements : colonne `source` (kpay | manuel) pour distinguer un encaissement K-PAY d'un marquage manuel ;
--  2. paiements : cohérence de la source (un paiement manuel, et lui seul, a le fournisseur 'manuel', n'a ni
--     identifiant fournisseur ni frais, et une référence 'manuel-' || id) ;
--  3. paiements : index de la liste de l'administration et des revenus du mois ;
--  4. webhooks_refuses : compteur HORAIRE des webhooks refusés (aucun corps, aucune IP, aucun en-tête).
-- `abonnements.origine` n'est PAS recréée ici : elle est livrée par la migration 0029 (A2).
-- Tables, colonnes, index, contraintes et snapshot (meta/0030_snapshot.json) générés par drizzle-kit à partir de
-- shared/db/schema.ts ; la forme idempotente (IF NOT EXISTS / DROP IF EXISTS), le NOT VALID + VALIDATE et le bloc
-- ROLLBACK sont ajoutés à la main. Les noms de contraintes et d'index sont ceux de drizzle-kit : un second
-- `db:generate` doit répondre « No schema changes ».
-- ÉCART DE LA SPEC §3 (voir rapport) : paiements_source_coherence_check n'impose PAS « source = 'kpay' <=>
-- fournisseur = 'kpay' » mais « source = 'manuel' <=> fournisseur = 'manuel' ». Raison : `fournisseur` n'est pas une
-- énumération en base (règle S10 : ajouter un fournisseur ne demande aucune migration) et une ligne `stripe` est
-- créée par tests/integration/webhook-kpay-route.test.ts. Toutes les garanties propres au paiement manuel sont
-- conservées. Pour appliquer la formule de la spec à la lettre, remplacer la première ligne du CHECK par
-- ("source" = 'kpay') = ("fournisseur" = 'kpay').
-- SECOND ÉCART : `reference_fournisseur IS NOT NULL` explicite. `reference_fournisseur = 'manuel-' || id` vaut NULL
-- quand la référence est NULL, et PostgreSQL ACCEPTE un CHECK qui vaut NULL : un paiement manuel sans référence
-- passait (prouvé par migration-0030.test.ts).
-- Verrous : ADD COLUMN avec valeur par défaut CONSTANTE (PostgreSQL 11+) = métadonnées seules, aucune réécriture de
-- `paiements`, aucun backfill (toutes les lignes existantes valent source='kpay'). Les CHECK sont posés NOT VALID
-- puis validés (SHARE UPDATE EXCLUSIVE, sans bloquer les écritures). Limite : drizzle-kit migrate enveloppe tout dans
-- UNE transaction ; CREATE INDEX CONCURRENTLY y est impossible et les deux index de `paiements` posent un verrou
-- SHARE (écritures bloquées le temps de la construction). Acceptable : `paiements` est petite à ce stade ; à jouer
-- hors pic de trafic. Si elle devenait grande, créer les deux index à la main avec CONCURRENTLY AVANT la
-- migration (IF NOT EXISTS les ignorera).
-- Idempotent : rejouable sans erreur ni perte (le compteur webhooks_refuses n'est jamais modifié).
-- La liste des motifs de webhooks_refuses est recopiée en dur ; sa source côté application est shared/paiements.ts.

-- 1. paiements.source (kpay | manuel). Les lignes existantes sont K-PAY.
ALTER TABLE "paiements" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'kpay' NOT NULL;--> statement-breakpoint
ALTER TABLE "paiements" DROP CONSTRAINT IF EXISTS "paiements_source_check";--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_source_check" CHECK ("paiements"."source" IN ('kpay','manuel')) NOT VALID;--> statement-breakpoint
ALTER TABLE "paiements" VALIDATE CONSTRAINT "paiements_source_check";--> statement-breakpoint

-- 2. Cohérence du paiement manuel. Les index uniques (fournisseur, id_fournisseur) et (fournisseur,
--    reference_fournisseur) sont INCHANGÉS : un manuel ne peut pas entrer en collision avec une référence K-PAY
--    (fournisseur différent).
ALTER TABLE "paiements" DROP CONSTRAINT IF EXISTS "paiements_source_coherence_check";--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_source_coherence_check" CHECK (("paiements"."source" = 'manuel') = ("paiements"."fournisseur" = 'manuel')
        AND ("paiements"."source" = 'kpay' OR (
          "paiements"."methode" = 'manuel' AND "paiements"."statut" IN ('cree','reussi')
          AND "paiements"."id_fournisseur" IS NULL AND "paiements"."reference_fournisseur" IS NOT NULL
          AND "paiements"."reference_fournisseur" = 'manuel-' || "paiements"."id"
          AND "paiements"."frais_taux_pb" = 0 AND "paiements"."frais_estimes" = 0 AND "paiements"."net_estime" = "paiements"."montant"
          AND "paiements"."code_echec" IS NULL AND "paiements"."initiation_incertaine" = false
        ))) NOT VALID;--> statement-breakpoint
ALTER TABLE "paiements" VALIDATE CONSTRAINT "paiements_source_coherence_check";--> statement-breakpoint

-- 3. Index. Requêtes réelles : liste des paiements filtrée par statut, plus récents d'abord ; revenus du mois par
--    devise (somme des `reussi` bornée par applique_le, D-A3-01), l'index partiel ne contenant que les encaissés.
CREATE INDEX IF NOT EXISTS "paiements_liste_admin_idx" ON "paiements" USING btree ("statut","created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paiements_encaisse_idx" ON "paiements" USING btree ("devise","applique_le") WHERE "paiements"."statut" = 'reussi';--> statement-breakpoint

-- 4. Compteur des webhooks refusés : une ligne par heure, fournisseur et motif (taille bornée sous attaque).
--    La clé primaire (heure en tête) sert aussi l'alerte « plus de N refus sur 1 heure » et la purge à 90 jours.
CREATE TABLE IF NOT EXISTS "webhooks_refuses" (
	"heure" timestamp with time zone NOT NULL,
	"fournisseur" text NOT NULL,
	"motif" text NOT NULL,
	"nombre" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "webhooks_refuses_heure_fournisseur_motif_pk" PRIMARY KEY("heure","fournisseur","motif"),
	CONSTRAINT "webhooks_refuses_fournisseur_check" CHECK ("webhooks_refuses"."fournisseur" ~ '^[a-z0-9_-]{1,40}$'),
	CONSTRAINT "webhooks_refuses_motif_check" CHECK ("webhooks_refuses"."motif" IN ('SIGNATURE_INVALIDE','CORPS_TROP_GROS')),
	CONSTRAINT "webhooks_refuses_nombre_check" CHECK ("webhooks_refuses"."nombre" >= 1)
);

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- IMPOSSIBLE sans perte une fois une ligne paiements.source='manuel' créée (pièce comptable) : le DO ci-dessous
-- ABANDONNE alors la transaction ; dans ce cas restaurer depuis la sauvegarde. PERTE : le compteur
-- webhooks_refuses. Ordre : table, contraintes, index, colonne, puis le journal drizzle (created_at = valeur « when »
-- de l'idx 30 de meta/_journal.json, soit 1794692363718).
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM paiements WHERE source = 'manuel') THEN
--     RAISE EXCEPTION 'rollback 0030 refusé : des paiements manuels existent (pièces comptables)';
--   END IF;
-- END $$;
-- DROP TABLE IF EXISTS webhooks_refuses;
-- DROP INDEX IF EXISTS paiements_encaisse_idx;
-- DROP INDEX IF EXISTS paiements_liste_admin_idx;
-- ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_source_coherence_check;
-- ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_source_check;
-- ALTER TABLE paiements DROP COLUMN IF EXISTS source;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794692363718; -- when de l'idx 30 de meta/_journal.json
-- COMMIT;
