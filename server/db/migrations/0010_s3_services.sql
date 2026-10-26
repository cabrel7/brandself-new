-- S3 : durcissement de la table services (docs/specs/S3-services.md §3).
-- Migration écrite à la main (comme 0009) : drizzle-kit ne sait pas normaliser les données avant de
-- poser les contraintes. meta/0010_snapshot.json est un snapshot COMPLET de shared/db/schema.ts et
-- sert de point de départ aux prochains `db:generate` (un second `db:generate` doit répondre
-- « No schema changes »).
-- Les listes de valeurs des CHECK sont recopiées en dur ; leur source côté application est
-- shared/services.ts (types, tarifs, paiements, rythmes, bornes) et shared/compte.ts (devises).
-- Table de petite taille (quelques dizaines de lignes par vitrine) : les ADD CONSTRAINT (scan complet,
-- verrou bref) et CREATE UNIQUE INDEX non concurrent (drizzle migre dans une transaction) sont acceptés.
-- ADD COLUMN ... DEFAULT constant : pas de réécriture de la table (PostgreSQL 11 et plus).

-- 1. Colonnes : durée facultative (prestation sur devis) ; liste « ce que comprend le service ».
ALTER TABLE services ALTER COLUMN duree_min DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE services ADD COLUMN inclus text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint

-- 2. Remise en conformité des données existantes (développement), AVANT les contraintes.
-- Chaque instruction est idempotente : la relancer ne change plus rien.
UPDATE services SET type = 'rdv' WHERE type NOT IN ('rdv','accompagnement','atelier','devis');
--> statement-breakpoint
UPDATE services SET tarif = 'devis' WHERE type = 'devis' OR tarif NOT IN ('gratuit','payant','devis');
--> statement-breakpoint
UPDATE services SET tarif = 'devis' WHERE tarif = 'payant' AND (prix_montant IS NULL OR prix_montant <= 0);
--> statement-breakpoint
UPDATE services SET prix_devise = 'XAF'
  WHERE tarif = 'payant' AND (prix_devise IS NULL OR prix_devise NOT IN ('XAF','EUR','USD'));
--> statement-breakpoint
UPDATE services SET prix_montant = NULL, prix_devise = NULL, paiement_mode = NULL, paiement_instructions = NULL
  WHERE tarif <> 'payant';
--> statement-breakpoint
UPDATE services SET prix_montant = 1000000000 WHERE prix_montant > 1000000000;
--> statement-breakpoint
UPDATE services SET paiement_mode = 'sur_place'
  WHERE tarif = 'payant' AND (paiement_mode IS NULL OR paiement_mode NOT IN ('en_ligne','sur_place','au_choix'));
--> statement-breakpoint
UPDATE services SET rythme = CASE
    WHEN lower(rythme) IN ('hebdomadaire','bimensuel','mensuel','libre') THEN lower(rythme)
    WHEN lower(rythme) LIKE 'hebdo%' THEN 'hebdomadaire'
    WHEN lower(rythme) LIKE 'bimens%' THEN 'bimensuel'
    WHEN lower(rythme) LIKE 'mensu%' THEN 'mensuel'
    ELSE NULL END
  WHERE rythme IS NOT NULL;
--> statement-breakpoint
UPDATE services SET nb_seances = NULL, rythme = NULL WHERE type <> 'accompagnement';
--> statement-breakpoint
UPDATE services SET nb_seances = GREATEST(2, LEAST(52, COALESCE(nb_seances, 2))) WHERE type = 'accompagnement';
--> statement-breakpoint
UPDATE services SET duree_min = GREATEST(5, LEAST(1440, COALESCE(duree_min, 30))) WHERE type <> 'devis';
--> statement-breakpoint
UPDATE services SET duree_min = NULL WHERE type = 'devis' AND (duree_min < 5 OR duree_min > 1440);
--> statement-breakpoint
UPDATE services SET ordre = 0 WHERE ordre < 0;
--> statement-breakpoint
UPDATE services SET en_vedette = false WHERE actif = false;
--> statement-breakpoint
UPDATE services s SET en_vedette = false FROM (
  SELECT id, row_number() OVER (PARTITION BY vitrine_id ORDER BY ordre, created_at, id) AS rang
  FROM services WHERE en_vedette) v
  WHERE s.id = v.id AND v.rang > 3;
--> statement-breakpoint
-- Image : doit exister ET appartenir au propriétaire de la vitrine (aucune FK n'existait jusqu'ici).
UPDATE services s SET image_media_id = NULL WHERE image_media_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM medias m JOIN vitrines v ON v.user_id = m.user_id
  WHERE m.id = s.image_media_id AND v.id = s.vitrine_id);
--> statement-breakpoint
-- Slug : format valide, puis unicité par vitrine (le doublon de plus grand id est suffixé de 8 hex).
UPDATE services SET slug = 'service-' || substr(md5(id), 1, 8)
  WHERE char_length(slug) NOT BETWEEN 1 AND 80 OR slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
--> statement-breakpoint
UPDATE services s SET slug = rtrim(left(s.slug, 71), '-') || '-' || substr(md5(s.id), 1, 8)
  WHERE EXISTS (SELECT 1 FROM services o WHERE o.vitrine_id = s.vitrine_id AND o.slug = s.slug AND o.id < s.id);
--> statement-breakpoint

-- 3. Index : unicité PAR vitrine (couvre aussi les recherches par vitrine_id) ; anciens index supprimés.
DROP INDEX IF EXISTS services_slug_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS services_actif_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS services_vitrine_id_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX services_vitrine_id_slug_unique ON services (vitrine_id, slug);
--> statement-breakpoint

-- 4. Image = ligne medias (CLAUDE.md §4 règle 4) : FK ON DELETE SET NULL + index (la FK est parcourue
-- à chaque suppression de média, et par deleteMediaIfUnreferenced).
ALTER TABLE services ADD CONSTRAINT services_image_media_id_medias_id_fk
  FOREIGN KEY (image_media_id) REFERENCES medias(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX services_image_media_id_idx ON services (image_media_id);
--> statement-breakpoint

-- 5. Contraintes.
ALTER TABLE services
  ADD CONSTRAINT services_type_check CHECK (type IN ('rdv','accompagnement','atelier','devis')),
  ADD CONSTRAINT services_tarif_check CHECK (tarif IN ('gratuit','payant','devis')),
  ADD CONSTRAINT services_paiement_mode_check CHECK (paiement_mode IS NULL OR paiement_mode IN ('en_ligne','sur_place','au_choix')),
  ADD CONSTRAINT services_rythme_check CHECK (rythme IS NULL OR rythme IN ('hebdomadaire','bimensuel','mensuel','libre')),
  ADD CONSTRAINT services_prix_devise_check CHECK (prix_devise IS NULL OR prix_devise IN ('XAF','EUR','USD')),
  ADD CONSTRAINT services_prix_montant_check CHECK (prix_montant IS NULL OR prix_montant BETWEEN 1 AND 1000000000),
  ADD CONSTRAINT services_duree_min_check CHECK (duree_min IS NULL OR duree_min BETWEEN 5 AND 1440),
  ADD CONSTRAINT services_nb_seances_check CHECK (nb_seances IS NULL OR nb_seances BETWEEN 2 AND 52),
  ADD CONSTRAINT services_ordre_check CHECK (ordre >= 0),
  ADD CONSTRAINT services_slug_format_check CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT services_inclus_check CHECK (cardinality(inclus) <= 12),
  ADD CONSTRAINT services_duree_requise_check CHECK (type = 'devis' OR duree_min IS NOT NULL),
  ADD CONSTRAINT services_seances_type_check CHECK ((type = 'accompagnement') = (nb_seances IS NOT NULL)),
  ADD CONSTRAINT services_rythme_type_check CHECK (rythme IS NULL OR type = 'accompagnement'),
  ADD CONSTRAINT services_devis_tarif_check CHECK (type <> 'devis' OR tarif = 'devis'),
  ADD CONSTRAINT services_prix_tarif_check CHECK ((tarif = 'payant') = (prix_montant IS NOT NULL AND prix_devise IS NOT NULL)),
  ADD CONSTRAINT services_paiement_tarif_check CHECK ((tarif = 'payant') = (paiement_mode IS NOT NULL)),
  ADD CONSTRAINT services_vedette_actif_check CHECK (NOT en_vedette OR actif);

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction. Le bloc est
-- STRUCTUREL : les normalisations de données du §2 (types, prix, slugs, vedettes, images…) ne sont pas
-- réversibles, et la colonne inclus (donc son contenu) est supprimée. Après le rollback, retirer la
-- ligne de 0010 du journal de migration : created_at = valeur « when » de meta/_journal.json (idx 10).
-- BEGIN;
-- ALTER TABLE services
--   DROP CONSTRAINT services_vedette_actif_check, DROP CONSTRAINT services_paiement_tarif_check,
--   DROP CONSTRAINT services_prix_tarif_check, DROP CONSTRAINT services_devis_tarif_check,
--   DROP CONSTRAINT services_rythme_type_check, DROP CONSTRAINT services_seances_type_check,
--   DROP CONSTRAINT services_duree_requise_check, DROP CONSTRAINT services_inclus_check,
--   DROP CONSTRAINT services_slug_format_check, DROP CONSTRAINT services_ordre_check,
--   DROP CONSTRAINT services_nb_seances_check, DROP CONSTRAINT services_duree_min_check,
--   DROP CONSTRAINT services_prix_montant_check, DROP CONSTRAINT services_prix_devise_check,
--   DROP CONSTRAINT services_rythme_check, DROP CONSTRAINT services_paiement_mode_check,
--   DROP CONSTRAINT services_tarif_check, DROP CONSTRAINT services_type_check;
-- DROP INDEX services_image_media_id_idx;
-- ALTER TABLE services DROP CONSTRAINT services_image_media_id_medias_id_fk;
-- DROP INDEX services_vitrine_id_slug_unique;
-- CREATE INDEX services_vitrine_id_idx ON services (vitrine_id);
-- CREATE INDEX services_slug_idx ON services (slug);
-- CREATE INDEX services_actif_idx ON services (actif);
-- ALTER TABLE services DROP COLUMN inclus;
-- UPDATE services SET duree_min = 30 WHERE duree_min IS NULL;
-- ALTER TABLE services ALTER COLUMN duree_min SET NOT NULL;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <when de l'idx 10 dans _journal.json>;
-- COMMIT;
