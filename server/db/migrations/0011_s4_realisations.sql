-- S4 : durcissement de realisations + table realisation_images (docs/specs/S4-realisations.md §3).
-- Migration écrite à la main (comme 0009 et 0010) : drizzle-kit ne sait pas normaliser les données avant
-- de poser les contraintes. meta/0011_snapshot.json est un snapshot COMPLET de shared/db/schema.ts et
-- sert de point de départ aux prochains `db:generate` (un second `db:generate` doit répondre
-- « No schema changes »).
-- Les bornes des CHECK sont recopiées en dur ; leur source côté application est shared/realisations.ts
-- (années, longueur du lien, galerie) et shared/listes.ts (format et longueur du slug).
-- Table de petite taille (quelques dizaines de lignes par vitrine) : les ADD CONSTRAINT (scan complet,
-- verrou bref) et CREATE UNIQUE INDEX non concurrent (drizzle migre dans une transaction) sont acceptés.

-- 1. Remise en conformité des données existantes (développement), AVANT les contraintes.
-- Chaque instruction est idempotente : la relancer ne change plus rien.
UPDATE realisations SET description = NULL WHERE description IS NOT NULL AND btrim(description) = '';
--> statement-breakpoint
UPDATE realisations SET lieu = NULLIF(btrim(lieu), ''), role = NULLIF(btrim(role), '');
--> statement-breakpoint
-- Lien : rogné d'abord, puis « www.exemple.cm » reçoit https://, puis tout ce qui n'est pas http(s) ou
-- dépasse 500 caractères est effacé (un `javascript:` dans un href public serait un vecteur XSS).
UPDATE realisations SET lien = btrim(lien) WHERE lien IS NOT NULL;
--> statement-breakpoint
UPDATE realisations SET lien = 'https://' || lien
  WHERE lien IS NOT NULL AND lien !~* '^[a-z][a-z0-9+.-]*:' AND lien ~* '^[a-z0-9-]+(\.[a-z0-9-]+)+(/.*)?$';
--> statement-breakpoint
UPDATE realisations SET lien = NULL
  WHERE lien IS NOT NULL AND (lien !~* '^https?://[^[:space:]]+$' OR char_length(lien) > 500);
--> statement-breakpoint
UPDATE realisations SET annee = NULL WHERE annee IS NOT NULL AND annee NOT BETWEEN 1900 AND 2100;
--> statement-breakpoint
UPDATE realisations SET ordre = 0 WHERE ordre < 0;
--> statement-breakpoint
UPDATE realisations SET en_vedette = false WHERE actif = false;
--> statement-breakpoint
UPDATE realisations r SET en_vedette = false FROM (
  SELECT id, row_number() OVER (PARTITION BY vitrine_id ORDER BY ordre, created_at, id) AS rang
  FROM realisations WHERE en_vedette) v
  WHERE r.id = v.id AND v.rang > 3;
--> statement-breakpoint
-- Image : doit exister ET appartenir au propriétaire de la vitrine (aucune FK n'existait jusqu'ici).
UPDATE realisations r SET image_media_id = NULL WHERE image_media_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM medias m JOIN vitrines v ON v.user_id = m.user_id
  WHERE m.id = r.image_media_id AND v.id = r.vitrine_id);
--> statement-breakpoint
-- Slug : format valide, puis unicité par vitrine (le doublon de plus grand id est suffixé de 8 hex).
UPDATE realisations SET slug = 'realisation-' || substr(md5(id), 1, 8)
  WHERE char_length(slug) NOT BETWEEN 1 AND 80 OR slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
--> statement-breakpoint
UPDATE realisations r SET slug = rtrim(left(r.slug, 71), '-') || '-' || substr(md5(r.id), 1, 8)
  WHERE EXISTS (SELECT 1 FROM realisations o WHERE o.vitrine_id = r.vitrine_id AND o.slug = r.slug AND o.id < r.id);
--> statement-breakpoint

-- 2. Index : unicité PAR vitrine (couvre aussi les recherches par vitrine_id) ; anciens index supprimés.
DROP INDEX IF EXISTS realisations_slug_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS realisations_actif_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS realisations_vitrine_id_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX realisations_vitrine_id_slug_unique ON realisations (vitrine_id, slug);
--> statement-breakpoint

-- 3. Image principale = ligne medias (CLAUDE.md §4 règle 4) : FK ON DELETE SET NULL + index (la FK est
-- parcourue à chaque suppression de média, et par deleteMediaIfUnreferenced).
ALTER TABLE realisations ADD CONSTRAINT realisations_image_media_id_medias_id_fk
  FOREIGN KEY (image_media_id) REFERENCES medias(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX realisations_image_media_id_idx ON realisations (image_media_id);
--> statement-breakpoint

-- 4. Contraintes (structurelles et de sécurité ; les longueurs de texte restent dans Zod, comme S3).
ALTER TABLE realisations
  ADD CONSTRAINT realisations_slug_format_check CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT realisations_annee_check CHECK (annee IS NULL OR annee BETWEEN 1900 AND 2100),
  ADD CONSTRAINT realisations_lien_check CHECK (lien IS NULL OR (char_length(lien) <= 500 AND lien ~* '^https?://')),
  ADD CONSTRAINT realisations_ordre_check CHECK (ordre >= 0),
  ADD CONSTRAINT realisations_vedette_actif_check CHECK (NOT en_vedette OR actif);
--> statement-breakpoint

-- 5. Galerie : 6 images au plus, garanti par ordre ∈ [0,5] + unicité (realisation_id, ordre), sans trigger.
-- media_id CASCADE : supprimer un média retire la vignette ; deleteMediaIfUnreferenced protège les images
-- encore utilisées dans une galerie.
CREATE TABLE realisation_images (
  id text PRIMARY KEY NOT NULL,
  realisation_id text NOT NULL,
  media_id text NOT NULL,
  ordre integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT realisation_images_realisation_id_realisations_id_fk
    FOREIGN KEY (realisation_id) REFERENCES realisations(id) ON DELETE CASCADE,
  CONSTRAINT realisation_images_media_id_medias_id_fk
    FOREIGN KEY (media_id) REFERENCES medias(id) ON DELETE CASCADE,
  CONSTRAINT realisation_images_ordre_check CHECK (ordre BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX realisation_images_realisation_id_ordre_unique ON realisation_images (realisation_id, ordre);
--> statement-breakpoint
CREATE UNIQUE INDEX realisation_images_realisation_id_media_id_unique ON realisation_images (realisation_id, media_id);
--> statement-breakpoint
CREATE INDEX realisation_images_media_id_idx ON realisation_images (media_id);

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction. Le bloc est
-- STRUCTUREL : les normalisations de données du §1 (slugs, vedettes, liens, images…) ne sont pas
-- réversibles, et le contenu des galeries (table realisation_images) est perdu. La dernière ligne retire
-- 0011 du journal de migration : created_at = valeur « when » de meta/_journal.json (idx 11).
-- BEGIN;
-- DROP TABLE realisation_images;
-- ALTER TABLE realisations
--   DROP CONSTRAINT realisations_vedette_actif_check, DROP CONSTRAINT realisations_ordre_check,
--   DROP CONSTRAINT realisations_lien_check, DROP CONSTRAINT realisations_annee_check,
--   DROP CONSTRAINT realisations_slug_format_check;
-- DROP INDEX realisations_image_media_id_idx;
-- ALTER TABLE realisations DROP CONSTRAINT realisations_image_media_id_medias_id_fk;
-- DROP INDEX realisations_vitrine_id_slug_unique;
-- CREATE INDEX realisations_vitrine_id_idx ON realisations (vitrine_id);
-- CREATE INDEX realisations_slug_idx ON realisations (slug);
-- CREATE INDEX realisations_actif_idx ON realisations (actif);
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <when de l'idx 11 dans _journal.json>;
-- COMMIT;
