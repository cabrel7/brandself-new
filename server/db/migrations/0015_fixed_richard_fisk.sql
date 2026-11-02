CREATE TABLE "demandes" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"service_id" text NOT NULL,
	"nom" text NOT NULL,
	"email" text NOT NULL,
	"telephone" text NOT NULL,
	"message" text,
	"statut" text DEFAULT 'nouvelle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demandes_statut_check" CHECK ("demandes"."statut" IN ('nouvelle', 'en_cours', 'traitee', 'refusee')),
	CONSTRAINT "demandes_message_check" CHECK ("demandes"."message" IS NULL OR char_length("demandes"."message") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "disponibilites" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"jour_semaine" integer NOT NULL,
	"debut" time NOT NULL,
	"fin" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disponibilites_jour_semaine_check" CHECK ("disponibilites"."jour_semaine" BETWEEN 1 AND 7),
	CONSTRAINT "disponibilites_plage_check" CHECK ("disponibilites"."debut" < "disponibilites"."fin")
);
--> statement-breakpoint
CREATE TABLE "indisponibilites" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"date" date NOT NULL,
	"raison" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indisponibilites_raison_check" CHECK ("indisponibilites"."raison" IS NULL OR char_length("indisponibilites"."raison") <= 200)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"service_id" text NOT NULL,
	"nom" text NOT NULL,
	"email" text NOT NULL,
	"telephone" text NOT NULL,
	"note" text,
	"motif_annulation" text,
	"debut" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"paiement_choisi" text DEFAULT 'sur_place' NOT NULL,
	"paiement_statut" text DEFAULT 'non_requis' NOT NULL,
	"rappel_email" boolean DEFAULT false NOT NULL,
	"confirmation_token_hash" text NOT NULL,
	"confirmation_expire_le" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_plage_check" CHECK ("reservations"."debut" < "reservations"."fin"),
	CONSTRAINT "reservations_statut_check" CHECK ("reservations"."statut" IN ('en_attente', 'confirmee', 'annulee', 'terminee')),
	CONSTRAINT "reservations_paiement_choisi_check" CHECK ("reservations"."paiement_choisi" = 'sur_place'),
	CONSTRAINT "reservations_paiement_statut_check" CHECK ("reservations"."paiement_statut" = 'non_requis'),
	CONSTRAINT "reservations_note_check" CHECK ("reservations"."note" IS NULL OR char_length("reservations"."note") <= 1000),
	CONSTRAINT "reservations_motif_annulation_check" CHECK ("reservations"."motif_annulation" IS NULL OR char_length("reservations"."motif_annulation") <= 1000),
	CONSTRAINT "reservations_confirmation_hash_check" CHECK ("reservations"."confirmation_token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "vitrines" ALTER COLUMN "pas_creneau_min" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "vitrines" ALTER COLUMN "preavis_heures" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "vitrines" ALTER COLUMN "horizon_jours" SET DEFAULT 60;--> statement-breakpoint
UPDATE "vitrines"
SET "pas_creneau_min" = CASE WHEN "pas_creneau_min" = 15 THEN 30 ELSE "pas_creneau_min" END,
	"preavis_heures" = CASE WHEN "preavis_heures" = 24 THEN 2 ELSE "preavis_heures" END,
	"horizon_jours" = CASE WHEN "horizon_jours" = 30 THEN 60 ELSE "horizon_jours" END
WHERE "pas_creneau_min" = 15 OR "preavis_heures" = 24 OR "horizon_jours" = 30;--> statement-breakpoint
ALTER TABLE "demandes" ADD CONSTRAINT "demandes_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "public"."vitrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demandes" ADD CONSTRAINT "demandes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disponibilites" ADD CONSTRAINT "disponibilites_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "public"."vitrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indisponibilites" ADD CONSTRAINT "indisponibilites_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "public"."vitrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "public"."vitrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demandes_vitrine_id_created_at_idx" ON "demandes" USING btree ("vitrine_id","created_at");--> statement-breakpoint
CREATE INDEX "demandes_service_id_idx" ON "demandes" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "demandes_vitrine_id_statut_idx" ON "demandes" USING btree ("vitrine_id","statut");--> statement-breakpoint
CREATE INDEX "disponibilites_vitrine_id_jour_idx" ON "disponibilites" USING btree ("vitrine_id","jour_semaine","debut");--> statement-breakpoint
CREATE UNIQUE INDEX "indisponibilites_vitrine_id_date_unique" ON "indisponibilites" USING btree ("vitrine_id","date");--> statement-breakpoint
CREATE INDEX "reservations_vitrine_id_debut_idx" ON "reservations" USING btree ("vitrine_id","debut");--> statement-breakpoint
CREATE INDEX "reservations_service_id_idx" ON "reservations" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "reservations_vitrine_id_statut_idx" ON "reservations" USING btree ("vitrine_id","statut");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_confirmation_token_hash_unique" ON "reservations" USING btree ("confirmation_token_hash");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vitrine_creneau_actif_excl"
	EXCLUDE USING gist (
		"vitrine_id" WITH =,
		tstzrange("debut", "fin", '[)') WITH &&
	)
	WHERE ("statut" IN ('en_attente', 'confirmee'));--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_pas_creneau_min_check" CHECK ("vitrines"."pas_creneau_min" IN (15, 30, 60));--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_preavis_heures_check" CHECK ("vitrines"."preavis_heures" BETWEEN 0 AND 720);--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_horizon_jours_check" CHECK ("vitrines"."horizon_jours" BETWEEN 1 AND 365);
