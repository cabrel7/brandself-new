-- S11 : statistiques de la vitrine (docs/specs/S11-statistiques.md §2, décisions #167 à #190).
-- Écrit à la main (convention du projet : `meta/0022_snapshot.json` est le snapshot complet regénéré
-- par `pnpm db:generate` ; un second `generate` doit répondre « nothing to migrate »).
-- Contenu :
--   vues              : lignes brutes d'une visite (empreinte HMAC journalière, JAMAIS d'IP brute),
--                       rétention 90 jours.
--   statistiques_jour : agrégats quotidiens totaux (visites, visiteurs uniques, clics), 180 jours.
--   statistiques_jour_pages : agrégats quotidiens par type de page.
--   statistiques_jour_sources : agrégats quotidiens par source.
-- Rétention (#174) : pas de verrou sur l'existant, tables neuves, FK en CASCADE.
-- Les CHECK sont recopiés depuis shared/statistiques.ts : garder synchronisées.

CREATE TABLE "vues" (
  "id" text PRIMARY KEY NOT NULL,
  "vitrine_id" text NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "empreinte" text NOT NULL,
  "page_type" text NOT NULL,
  "page_identifiant" text NOT NULL DEFAULT '',
  "source" text NOT NULL,
  "appareil" text NOT NULL,
  "pays" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vues_empreinte_check" CHECK ("empreinte" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "vues_page_type_check" CHECK ("page_type" IN ('accueil','service','realisation','agenda','contact','reservation','autre')),
  CONSTRAINT "vues_page_identifiant_check" CHECK (char_length("page_identifiant") <= 80
    AND ("page_identifiant" = '' OR "page_identifiant" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')),
  CONSTRAINT "vues_source_check" CHECK ("source" IN ('direct','interne','google','bing','duckduckgo','yahoo','facebook','instagram','linkedin','twitter','x','youtube','tiktok','whatsapp','telegram','pinterest','reddit','autre')),
  CONSTRAINT "vues_appareil_check" CHECK ("appareil" IN ('mobile','tablette','ordinateur','inconnu')),
  CONSTRAINT "vues_pays_check" CHECK ("pays" IS NULL OR "pays" ~ '^[A-Z]{2}$')
);
CREATE INDEX "vues_vitrine_id_jour_idx" ON "vues" ("vitrine_id", "jour");
CREATE INDEX "vues_jour_idx" ON "vues" ("jour");

CREATE TABLE "statistiques_jour" (
  "vitrine_id" text NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "visites" integer DEFAULT 0 NOT NULL CHECK ("visites" >= 0),
  "visiteurs_uniques" integer DEFAULT 0 NOT NULL CHECK ("visiteurs_uniques" >= 0),
  "clics" integer DEFAULT 0 NOT NULL CHECK ("clics" >= 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("vitrine_id", "jour")
);

CREATE TABLE "statistiques_jour_pages" (
  "vitrine_id" text NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "page_type" text NOT NULL,
  "page_identifiant" text NOT NULL DEFAULT '',
  "visites" integer DEFAULT 0 NOT NULL CHECK ("visites" >= 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("vitrine_id", "jour", "page_type", "page_identifiant"),
  CONSTRAINT "spj_page_type_check" CHECK ("page_type" IN ('accueil','service','realisation','agenda','contact','reservation','autre')),
  CONSTRAINT "spj_page_identifiant_check" CHECK (char_length("page_identifiant") <= 80
    AND ("page_identifiant" = '' OR "page_identifiant" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'))
);

CREATE TABLE "statistiques_jour_sources" (
  "vitrine_id" text NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "source" text NOT NULL,
  "visites" integer DEFAULT 0 NOT NULL CHECK ("visites" >= 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("vitrine_id", "jour", "source"),
  CONSTRAINT "sjs_source_check" CHECK ("source" IN ('direct','interne','google','bing','duckduckgo','yahoo','facebook','instagram','linkedin','twitter','x','youtube','tiktok','whatsapp','telegram','pinterest','reddit','autre'))
);
