-- Custom SQL migration file, put your code below! --

-- Table liens (PROJECT_CONTEXT.md §11).
-- Un lien publié sur une vitrine (site externe, WhatsApp, email, téléphone, autre vitrine...).
-- Colonnes en français sans accents.
CREATE TABLE "liens" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"libelle" text NOT NULL,
	"url" text NOT NULL,
	"type" text NOT NULL,
	"ordre" integer NOT NULL DEFAULT 0,
	"clics" integer NOT NULL DEFAULT 0,
	"actif" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "liens_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "vitrines"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "liens_vitrine_id_idx" ON "liens" ("vitrine_id");
--> statement-breakpoint
CREATE INDEX "liens_actif_idx" ON "liens" ("actif");
