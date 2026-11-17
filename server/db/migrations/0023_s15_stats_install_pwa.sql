-- S15 : statistiques d'installation PWA pour le super admin de la plateforme.
-- Événements : proposee / installee / refusee, origine studio ou marketing.
-- Pas de donnee personnelle, pas de lien vers une vitrine (plateforme, pas pro).
-- Retenue : pas de verrou sur l'existant, table neuve.

CREATE TABLE "pwa_install_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "origine" text NOT NULL,
  "device_type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pwa_install_events_type_check" CHECK ("type" IN ('proposee','installee','refusee')),
  CONSTRAINT "pwa_install_events_origine_check" CHECK ("origine" IN ('studio','marketing')),
  CONSTRAINT "pwa_install_events_device_type_check" CHECK ("device_type" IN ('mobile','tablette','ordinateur','inconnu'))
);
CREATE INDEX "pwa_install_events_type_origine_idx" ON "pwa_install_events" ("type", "origine");
CREATE INDEX "pwa_install_events_created_at_idx" ON "pwa_install_events" ("created_at");
