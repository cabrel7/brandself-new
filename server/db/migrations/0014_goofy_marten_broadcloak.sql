CREATE UNIQUE INDEX "temoignages_vitrine_id_slug_unique" ON "temoignages" USING btree ("vitrine_id","slug");--> statement-breakpoint
DROP INDEX "temoignages_slug_idx";
