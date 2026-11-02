CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"vitrine_id" text NOT NULL,
	"nom" text NOT NULL,
	"email" text NOT NULL,
	"telephone" text,
	"sujet" text NOT NULL,
	"message" text NOT NULL,
	"lu_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sujet_check" CHECK ("messages"."sujet" IN ('question_avant_reservation','demande_information','suivi_reservation','autre')),
	CONSTRAINT "messages_nom_check" CHECK (char_length("messages"."nom") BETWEEN 1 AND 120),
	CONSTRAINT "messages_email_check" CHECK (char_length("messages"."email") <= 254 AND "messages"."email" ~ '^\S+@\S+'),
	CONSTRAINT "messages_telephone_check" CHECK ("messages"."telephone" IS NULL OR "messages"."telephone" ~ '^\+\d+$'),
	CONSTRAINT "messages_message_check" CHECK (char_length("messages"."message") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_statut_check";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_vitrine_id_vitrines_id_fk" FOREIGN KEY ("vitrine_id") REFERENCES "public"."vitrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_vitrine_id_cree_le_idx" ON "messages" USING btree (vitrine_id, created_at DESC);--> statement-breakpoint
CREATE INDEX "messages_non_lus_idx" ON "messages" USING btree (vitrine_id, created_at DESC) WHERE (lu_le IS NULL);--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("emails_transactionnels"."type" IN (
        'reservation_professionnel_nouvelle',
        'reservation_visiteur_recue',
        'reservation_visiteur_confirmee',
        'reservation_visiteur_annulee',
        'reservation_visiteur_refusee',
        'demande_professionnel_nouvelle',
        'demande_visiteur_recue',
        'message_professionnel_nouvelle'
      ));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check" CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande', 'message'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%')
        OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%')
        OR ("emails_transactionnels"."entite_type" = 'message' AND "emails_transactionnels"."type" LIKE 'message_%'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_statut_check" CHECK ("reservations"."statut" IN ('en_attente', 'confirmee', 'annulee', 'terminee', 'refusee'));