-- S16 : serveur MCP minimal — journal des appels d'assistant et origine des contenus.
-- Déploiement : serveur livré désactivé (`MCP_ACTIF=false`), activé par liste de pilotes puis tous les payants.
--
-- Contenu :
--   mcp_clients : clients OAuth 2.1 du serveur MCP (identifiant client, secret, portées, redirection).
--   mcp_tokens : jetons d'accès et de rafraîchissement émis aux assistants connectés.
--   journal_assistant : journal des appels d'assistant (utilisateur, assistant, outil, résumé des
--                       arguments, résultat, avant/après pour les modifications, date).
--   source (services, realisations) : origine du contenu — 'utilisateur' (studio) ou 'assistant' (MCP).
--                                     Valeur par défaut 'utilisateur', aucune réécriture de ligne existante.
--                                     Une contrainte CHECK restreint les valeurs.
--
-- Rétention : tables neuves (aucun verrou sur l'existant). La colonne `source` est ajoutée avec une
-- valeur par défaut, aucune ligne existante n'est modifiée. L'ancien code ignore la nouvelle colonne.
--
-- Les listes de valeurs (source) sont recopiées en dur ; leur source côté application est
-- shared/plans.ts (CAPACITES_PAYANTES) et le code des handlers MCP (server/mcp/). Garder synchronisées.
--
-- ROLLBACK (à jouer APRES le rollback de 0026 et 0025 ; destructif : perd le journal et les valeurs `source`) :
--   DROP TABLE IF EXISTS mcp_tokens, mcp_clients;   -- absentes si 0026 est appliquée
--   DROP TABLE journal_assistant;
--   ALTER TABLE realisations DROP CONSTRAINT IF EXISTS realisations_source_check, DROP COLUMN IF EXISTS source;
--   ALTER TABLE services DROP CONSTRAINT IF EXISTS services_source_check, DROP COLUMN IF EXISTS source;
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794117212506;  -- seulement si on rejoue 0024

-- DDL idempotent : une base qui a déjà reçu `source` (et/ou realisations_source_check) par une ancienne
-- version de 0011 ou de 0024 doit pouvoir rejouer cette migration sans erreur.
-- ADD COLUMN avec défaut constant : métadonnée seule (PG >= 11), aucune réécriture de table.
ALTER TABLE services ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'utilisateur';
ALTER TABLE realisations ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'utilisateur';

-- Contraintes CHECK des colonnes source (elles étaient, à tort, dans 0011 pour realisations et
-- absentes pour services ; 0011 ayant déjà été appliqué partout, le S16 les place ici).
-- DROP IF EXISTS puis ADD : même nom, même définition, quelle que soit l'histoire de la base.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_source_check;
ALTER TABLE services ADD CONSTRAINT services_source_check CHECK (source IN ('utilisateur','assistant'));
ALTER TABLE realisations DROP CONSTRAINT IF EXISTS realisations_source_check;
ALTER TABLE realisations ADD CONSTRAINT realisations_source_check CHECK (source IN ('utilisateur','assistant'));

CREATE TABLE journal_assistant (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assistant_id text NOT NULL,
  outil text NOT NULL,
  arguments_resume jsonb NOT NULL,
  resultat jsonb,
  avant jsonb,
  apres jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX journal_assistant_user_id_idx ON journal_assistant(user_id);
CREATE INDEX journal_assistant_created_at_idx ON journal_assistant(created_at);

-- Clients OAuth 2.1 du serveur MCP. Chaque assistant connecté possède un client avec son propre
-- identifiant, son secret et ses portées autorisées.
CREATE TABLE mcp_clients (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL UNIQUE,
  client_secret text NOT NULL,
  nom text NOT NULL,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['vitrine:lecture']::text[],
  actif boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX mcp_clients_user_id_idx ON mcp_clients(user_id);
CREATE INDEX mcp_clients_client_id_idx ON mcp_clients(client_id);

-- Jetons d'accès et de rafraîchissement émis aux assistants. court_est_valide = jeton encore valide.
CREATE TABLE mcp_tokens (
  id text PRIMARY KEY NOT NULL,
  client_id text NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text NOT NULL UNIQUE,
  refresh_token text NOT NULL UNIQUE,
  access_token_expires_at timestamp with time zone NOT NULL,
  refresh_token_expires_at timestamp with time zone NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  revoke boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX mcp_tokens_client_id_idx ON mcp_tokens(client_id);
CREATE INDEX mcp_tokens_user_id_idx ON mcp_tokens(user_id);
CREATE INDEX mcp_tokens_access_token_idx ON mcp_tokens(access_token);
CREATE INDEX mcp_tokens_refresh_token_idx ON mcp_tokens(refresh_token);

-- Le serveur MCP est livré désactivé : aucune donnée n'est écrite tant que `MCP_ACTIF=true` et qu'un
-- abonnement payant est actif. Les brouillons existants créés par un assistant sont conservés à
-- l'expiration de l'abonnement.
