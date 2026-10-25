-- Custom SQL migration file, put your code below! --

-- Table services (PROJECT_CONTEXT.md §11).
-- Une vitrine propose des services : rendez-vous, accompagnement, atelier, prestation sur devis.
-- Colonnes en français sans accents.
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"slug" text NOT NULL,
	"titre" text NOT NULL,
	"description" text,
	"image_media_id" text,
	"type" text NOT NULL,
	"nb_seances" integer,
	"rythme" text,
	"duree_min" integer NOT NULL,
	"tarif" text NOT NULL,
	"prix_montant" integer,
	"prix_devise" text,
	"paiement_mode" text,
	"paiement_instructions" text,
	"reservable" boolean NOT NULL DEFAULT true,
	"en_vedette" boolean NOT NULL DEFAULT false,
	"ordre" integer NOT NULL DEFAULT 0,
	"actif" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "services_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "vitrines"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "services_vitrine_id_idx" ON "services" ("vitrine_id");
--> statement-breakpoint
CREATE INDEX "services_slug_idx" ON "services" ("slug");
--> statement-breakpoint
CREATE INDEX "services_actif_idx" ON "services" ("actif");
