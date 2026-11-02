CREATE TABLE "emails_transactionnels" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"entite_type" text NOT NULL,
	"entite_id" text NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"tentatives" integer DEFAULT 0 NOT NULL,
	"prochaine_tentative" timestamp with time zone DEFAULT now(),
	"erreur_code" text,
	"envoye_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_transactionnels_type_check" CHECK ("emails_transactionnels"."type" IN (
        'reservation_professionnel_nouvelle',
        'reservation_visiteur_recue',
        'reservation_visiteur_confirmee',
        'reservation_visiteur_annulee',
        'demande_professionnel_nouvelle',
        'demande_visiteur_recue'
      )),
	CONSTRAINT "emails_transactionnels_entite_type_check" CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande')),
	CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%')
        OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%')),
	CONSTRAINT "emails_transactionnels_statut_check" CHECK ("emails_transactionnels"."statut" IN ('en_attente', 'en_cours', 'envoye', 'echec')),
	CONSTRAINT "emails_transactionnels_tentatives_check" CHECK ("emails_transactionnels"."tentatives" BETWEEN 0 AND 5),
	CONSTRAINT "emails_transactionnels_erreur_code_check" CHECK ("emails_transactionnels"."erreur_code" IS NULL OR (
        char_length("emails_transactionnels"."erreur_code") BETWEEN 1 AND 64
        AND "emails_transactionnels"."erreur_code" ~ '^[A-Z0-9_]+$'
      )),
	CONSTRAINT "emails_transactionnels_envoye_le_check" CHECK (("emails_transactionnels"."statut" = 'envoye') = ("emails_transactionnels"."envoye_le" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "emails_transactionnels_entite_evenement_unique" ON "emails_transactionnels" USING btree ("entite_type","entite_id","type");--> statement-breakpoint
CREATE INDEX "emails_transactionnels_pending_idx" ON "emails_transactionnels" USING btree ("prochaine_tentative","created_at") WHERE "emails_transactionnels"."statut" = 'en_attente';