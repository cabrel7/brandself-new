-- Custom SQL migration file, put your code below! --

-- Active btree_gist : requis pour la contrainte d'exclusion des réservations
-- (plage [debut, fin) par vitrine, voir PROJECT_CONTEXT.md §11 — garantis en S7).
CREATE EXTENSION IF NOT EXISTS btree_gist;
