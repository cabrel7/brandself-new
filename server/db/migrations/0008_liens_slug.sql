-- Custom SQL migration file, put your code below! --

-- Ajout du champ slug sur la table liens (oublié dans 0007).
ALTER TABLE "liens" ADD COLUMN "slug" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "liens_slug_idx" ON "liens" ("slug");
