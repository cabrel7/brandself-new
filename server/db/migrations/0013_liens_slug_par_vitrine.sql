DROP INDEX "liens_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "liens_vitrine_id_slug_unique" ON "liens" USING btree ("vitrine_id","slug");