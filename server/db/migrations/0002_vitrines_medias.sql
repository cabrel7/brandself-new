-- Custom SQL migration file, put your code below! --

-- Tables vitrines et medias (PROJECT_CONTEXT.md §11).
-- Colonnes en français sans accents. Une image = une ligne medias, jamais un chemin dans une autre table.
CREATE TABLE "vitrines" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL UNIQUE,
	"username" text NOT NULL UNIQUE,
	"titre" text NOT NULL,
	"prenom" text NOT NULL,
	"nom" text NOT NULL,
	"metier" text NOT NULL,
	"ville" text NOT NULL,
	"pays" text NOT NULL,
	"accroche" text,
	"bio" text,
	"photo_media_id" text,
	"email_contact" text,
	"telephone" text,
	"whatsapp" text,
	"palette" text NOT NULL DEFAULT 'terracotta',
	"seo_titre" text,
	"seo_description" text,
	"sections_masquees" text[] NOT NULL DEFAULT '{}',
	"fuseau" text NOT NULL DEFAULT 'Africa/Douala',
	"pas_creneau_min" integer NOT NULL DEFAULT 15,
	"preavis_heures" integer NOT NULL DEFAULT 24,
	"horizon_jours" integer NOT NULL DEFAULT 30,
	"publiee_le" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "vitrines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "vitrines_username_idx" ON "vitrines" ("username");
--> statement-breakpoint
CREATE INDEX "vitrines_user_id_idx" ON "vitrines" ("user_id");
--> statement-breakpoint
CREATE TABLE "medias" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"disk" text NOT NULL DEFAULT 'local',
	"chemin" text NOT NULL,
	"mime" text NOT NULL,
	"taille" integer NOT NULL,
	"largeur" integer,
	"hauteur" integer,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "medias_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "medias_user_id_idx" ON "medias" ("user_id");
