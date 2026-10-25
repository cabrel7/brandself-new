-- Custom SQL migration file, put your code below! --

-- Table realisations (PROJECT_CONTEXT.md §11).
-- Une réalisation publiée par une vitrine (projet, oeuvre, experience...).
-- Colonnes en français sans accents.
CREATE TABLE "realisations" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"slug" text NOT NULL,
	"titre" text NOT NULL,
	"description" text,
	"image_media_id" text,
	"annee" integer,
	"lieu" text,
	"role" text,
	"lien" text,
	"en_vedette" boolean NOT NULL DEFAULT false,
	"ordre" integer NOT NULL DEFAULT 0,
	"actif" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "realisations_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "vitrines"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "realisations_vitrine_id_idx" ON "realisations" ("vitrine_id");
--> statement-breakpoint
CREATE INDEX "realisations_slug_idx" ON "realisations" ("slug");
--> statement-breakpoint
CREATE INDEX "realisations_actif_idx" ON "realisations" ("actif");
