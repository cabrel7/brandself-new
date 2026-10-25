-- Custom SQL migration file, put your code below! --

-- Table temoignages (PROJECT_CONTEXT.md §11).
-- Un témoignage publié sur une vitrine.
-- Colonnes en français sans accents.
CREATE TABLE "temoignages" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"auteur" text NOT NULL,
	"fonction" text,
	"texte" text NOT NULL,
	"en_vedette" boolean NOT NULL DEFAULT false,
	"ordre" integer NOT NULL DEFAULT 0,
	"actif" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "temoignages_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "vitrines"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "temoignages_vitrine_id_idx" ON "temoignages" ("vitrine_id");
--> statement-breakpoint
CREATE INDEX "temoignages_actif_idx" ON "temoignages" ("actif");
