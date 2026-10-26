-- S2 : correction du modèle vitrines / medias (docs/specs/S2-backend.md §3).
-- Migration écrite à la main : drizzle-kit n'a de snapshot que pour 0000 et 0001 (0002 à 0008 sont
-- du SQL manuel), il voulait donc recréer toutes les tables. meta/0009_snapshot.json est un snapshot
-- COMPLET de shared/db/schema.ts : il sert de nouveau point de départ pour les prochains `db:generate`.
-- Les listes de valeurs des CHECK (titres, palettes) sont recopiées en dur ; leur source côté
-- application est shared/vitrine.ts (TITRES) et shared/palettes.ts (PALETTES).

-- 1. Médias de développement à chemin absolu : supprimés (spec §0, décision 22).
-- services.image_media_id et realisations.image_media_id n'ont pas de FK : on les met à NULL ici
-- pour ne laisser aucun identifiant orphelin.
UPDATE vitrines SET photo_media_id = NULL WHERE photo_media_id IN (SELECT id FROM medias WHERE chemin LIKE '/%');
--> statement-breakpoint
UPDATE services SET image_media_id = NULL WHERE image_media_id IN (SELECT id FROM medias WHERE chemin LIKE '/%');
--> statement-breakpoint
UPDATE realisations SET image_media_id = NULL WHERE image_media_id IN (SELECT id FROM medias WHERE chemin LIKE '/%');
--> statement-breakpoint
DELETE FROM medias WHERE chemin LIKE '/%';
--> statement-breakpoint

-- 2. titre : nullable, code en minuscules (dr, pr, me, m, mme) ; toute autre valeur devient NULL.
ALTER TABLE vitrines ALTER COLUMN titre DROP NOT NULL;
--> statement-breakpoint
UPDATE vitrines SET titre = CASE lower(replace(split_part(trim(titre),' ',1),'.',''))
  WHEN 'dr' THEN 'dr' WHEN 'pr' THEN 'pr' WHEN 'me' THEN 'me' WHEN 'm' THEN 'm' WHEN 'mme' THEN 'mme' ELSE NULL END;
--> statement-breakpoint
ALTER TABLE vitrines ADD CONSTRAINT vitrines_titre_check CHECK (titre IS NULL OR titre IN ('dr','pr','me','m','mme'));
--> statement-breakpoint

-- 3. ville et pays : nullables ; pays = code ISO sur deux lettres majuscules.
ALTER TABLE vitrines ALTER COLUMN ville DROP NOT NULL, ALTER COLUMN pays DROP NOT NULL;
--> statement-breakpoint
UPDATE vitrines SET ville = NULLIF(trim(ville),''),
  pays = CASE WHEN pays ~ '^[A-Z]{2}$' THEN pays WHEN lower(trim(pays)) = 'cameroun' THEN 'CM' ELSE NULL END;
--> statement-breakpoint
ALTER TABLE vitrines ADD CONSTRAINT vitrines_pays_check CHECK (pays IS NULL OR pays ~ '^[A-Z]{2}$');
--> statement-breakpoint

-- 4. palette et username : valeurs contraintes par la base.
UPDATE vitrines SET palette = 'terracotta' WHERE palette NOT IN ('terracotta','sauge','indigo','ocre','bordeaux');
--> statement-breakpoint
ALTER TABLE vitrines ADD CONSTRAINT vitrines_palette_check CHECK (palette IN ('terracotta','sauge','indigo','ocre','bordeaux'));
--> statement-breakpoint
ALTER TABLE vitrines ADD CONSTRAINT vitrines_username_format_check
  CHECK (char_length(username) BETWEEN 3 AND 30 AND username ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
--> statement-breakpoint

-- 5. Noms de contraintes alignés sur drizzle ; index redondants avec les contraintes UNIQUE supprimés.
ALTER TABLE vitrines RENAME CONSTRAINT vitrines_username_key TO vitrines_username_unique;
--> statement-breakpoint
ALTER TABLE vitrines RENAME CONSTRAINT vitrines_user_id_key TO vitrines_user_id_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS vitrines_username_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS vitrines_user_id_idx;
--> statement-breakpoint

-- 6. photo_media_id : FK vers medias (SET NULL à la suppression du média) + index.
UPDATE vitrines v SET photo_media_id = NULL WHERE photo_media_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM medias m WHERE m.id = v.photo_media_id);
--> statement-breakpoint
ALTER TABLE vitrines ADD CONSTRAINT vitrines_photo_media_id_medias_id_fk
  FOREIGN KEY (photo_media_id) REFERENCES medias(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX vitrines_photo_media_id_idx ON vitrines (photo_media_id);
--> statement-breakpoint

-- 7. medias.taille strictement positive.
ALTER TABLE medias ADD CONSTRAINT medias_taille_check CHECK (taille > 0);

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, puis supprimer
-- la ligne de 0009 dans drizzle.__drizzle_migrations. NON réversible : médias supprimés au §1,
-- valeurs de titre/pays/palette normalisées aux §2-4 (les anciennes valeurs libres sont perdues).
-- BEGIN;
-- ALTER TABLE medias DROP CONSTRAINT IF EXISTS medias_taille_check;
-- DROP INDEX IF EXISTS vitrines_photo_media_id_idx;
-- ALTER TABLE vitrines DROP CONSTRAINT IF EXISTS vitrines_photo_media_id_medias_id_fk;
-- CREATE INDEX IF NOT EXISTS vitrines_username_idx ON vitrines (username);
-- CREATE INDEX IF NOT EXISTS vitrines_user_id_idx ON vitrines (user_id);
-- ALTER TABLE vitrines RENAME CONSTRAINT vitrines_user_id_unique TO vitrines_user_id_key;
-- ALTER TABLE vitrines RENAME CONSTRAINT vitrines_username_unique TO vitrines_username_key;
-- ALTER TABLE vitrines DROP CONSTRAINT IF EXISTS vitrines_username_format_check;
-- ALTER TABLE vitrines DROP CONSTRAINT IF EXISTS vitrines_palette_check;
-- ALTER TABLE vitrines DROP CONSTRAINT IF EXISTS vitrines_pays_check;
-- ALTER TABLE vitrines DROP CONSTRAINT IF EXISTS vitrines_titre_check;
-- UPDATE vitrines SET titre = COALESCE(titre, ''), ville = COALESCE(ville, ''), pays = COALESCE(pays, '');
-- ALTER TABLE vitrines ALTER COLUMN titre SET NOT NULL, ALTER COLUMN ville SET NOT NULL, ALTER COLUMN pays SET NOT NULL;
-- COMMIT;
