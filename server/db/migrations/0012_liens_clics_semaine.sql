ALTER TABLE "liens" ADD COLUMN "clics_semaine" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "liens" ADD COLUMN "semaine_debut" date DEFAULT CURRENT_DATE NOT NULL;