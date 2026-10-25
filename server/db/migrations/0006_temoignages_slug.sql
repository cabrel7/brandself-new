-- Custom SQL migration file, put your code below! --

-- Ajout du champ slug sur la table temoignages (oublié dans 0005).
ALTER TABLE "temoignages" ADD COLUMN "slug" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "temoignages_slug_idx" ON "temoignages" ("slug");
