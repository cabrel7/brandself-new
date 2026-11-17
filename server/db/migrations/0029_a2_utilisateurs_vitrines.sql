-- A2 : utilisateurs, vitrines et assistants (docs/specs/A2-utilisateurs-vitrines.md §3, décisions D-A2-02, D-A2-04,
-- D-A2-05, D-A2-11, D-A2-14).
--  1. vitrines : blocage_admin + blocage_motif (dépublication par l'administration, `publiee_le` conservée) ;
--  2. abonnements : origine (paiement | offert | admin), colonne livrée ICI et non en A3 (spec A3 §1) ;
--  3. emails_transactionnels : 4 nouveaux types d'e-mail (utilisateur_suspendu, utilisateur_reactive,
--     utilisateur_jours_offerts, utilisateur_depubliee) ajoutés à la liste du CHECK de `type` ;
--  4. index des listes et de la recherche de l'administration (users, vitrines).
-- Colonnes, index, contraintes et snapshot (meta/0029_snapshot.json) générés par drizzle-kit à partir de
-- shared/db/schema.ts ; la forme idempotente (IF NOT EXISTS / DROP IF EXISTS), le NOT VALID + VALIDATE et le bloc
-- ROLLBACK sont ajoutés à la main. Les noms de contraintes et d'index sont ceux de drizzle-kit : un second
-- `db:generate` doit répondre « No schema changes ».
-- Verrous : ADD COLUMN avec valeur par défaut CONSTANTE (PostgreSQL 11+) = métadonnées seules, aucune réécriture de
-- `vitrines` ni d'`abonnements`, aucun backfill nécessaire (toutes les lignes existantes valent blocage_admin=false,
-- blocage_motif NULL, origine='paiement'). Les CHECK sont posés NOT VALID puis validés (balayage en
-- SHARE UPDATE EXCLUSIVE, sans bloquer les écritures). `emails_transactionnels_type_check` est ÉLARGI : toute ligne
-- existante le satisfait. Limite : drizzle-kit migrate enveloppe tout dans UNE transaction ; CREATE INDEX CONCURRENTLY
-- y est donc impossible, et le verrou ACCESS EXCLUSIVE des DROP/ADD CONSTRAINT dure jusqu'au COMMIT. Acceptable
-- (tables de petite taille à ce stade ; CHECK triviaux) ; à jouer hors pic de trafic. Si `users` devenait grande,
-- créer les trois index de `users` à la main avec CONCURRENTLY AVANT la migration (IF NOT EXISTS les ignorera).
-- Idempotent : rejouable sans erreur ni perte.
-- Les bornes du motif (5-500) et la liste des origines sont recopiées en dur ; leur source côté application est
-- shared/admin.ts (et shared/schemas/admin.ts). La liste des types d'e-mail est celle de shared/jobs.ts
-- (TRANSACTIONAL_EMAIL_TYPES). Garder synchronisées.
-- Index `oauth_*` sur `user_id` (oauth_access_tokens, oauth_refresh_tokens, oauth_consents) : déjà présents
-- (migration 0025), aucun ajout.
-- ÉCART DE LA SPEC §3 : vitrines_blocage_check contient `"blocage_motif" IS NOT NULL`. La formule de la spec
-- (char_length(btrim(motif)) BETWEEN 5 AND 500 seul) vaut NULL quand le motif est NULL, et PostgreSQL ACCEPTE un
-- CHECK qui vaut NULL : une vitrine bloquée sans motif passait (prouvé par migration-0029.test.ts).
-- ATTENTION (service, pas migration) : `emails_transactionnels_occurrence_check` limite `occurrence` à 32 caractères
-- ^[0-9A-Z:.-]*$. L'identifiant d'une entrée de journal est un UUID minuscule de 36 caractères : il est REFUSÉ.
-- Utiliser `journal_admin.numero` (chaîne décimale) comme occurrence (D-A2-14).

-- 1. vitrines : dépublication par l'administration.
ALTER TABLE "vitrines" ADD COLUMN IF NOT EXISTS "blocage_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vitrines" ADD COLUMN IF NOT EXISTS "blocage_motif" text;--> statement-breakpoint
ALTER TABLE "vitrines" DROP CONSTRAINT IF EXISTS "vitrines_blocage_check";--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_blocage_check" CHECK (("vitrines"."blocage_admin" = false AND "vitrines"."blocage_motif" IS NULL)
        OR ("vitrines"."blocage_admin" = true AND "vitrines"."blocage_motif" IS NOT NULL
          AND char_length(btrim("vitrines"."blocage_motif")) BETWEEN 5 AND 500)) NOT VALID;--> statement-breakpoint
ALTER TABLE "vitrines" VALIDATE CONSTRAINT "vitrines_blocage_check";--> statement-breakpoint

-- 2. abonnements : origine de la ligne (créée par un paiement, des jours offerts, ou un changement de plan admin).
ALTER TABLE "abonnements" ADD COLUMN IF NOT EXISTS "origine" text DEFAULT 'paiement' NOT NULL;--> statement-breakpoint
ALTER TABLE "abonnements" DROP CONSTRAINT IF EXISTS "abonnements_origine_check";--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_origine_check" CHECK ("abonnements"."origine" IN ('paiement','offert','admin')) NOT VALID;--> statement-breakpoint
ALTER TABLE "abonnements" VALIDATE CONSTRAINT "abonnements_origine_check";--> statement-breakpoint

-- 3. emails_transactionnels : 4 types d'e-mail de l'administration (entite_type 'utilisateur', déjà admis ainsi que
--    la cohérence `utilisateur_%` par emails_transactionnels_entite_coherence_check).
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT IF EXISTS "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("emails_transactionnels"."type" IN (
        'reservation_professionnel_nouvelle',
        'reservation_visiteur_recue',
        'reservation_visiteur_confirmee',
        'reservation_visiteur_annulee',
        'reservation_visiteur_refusee',
        'demande_professionnel_nouvelle',
        'demande_visiteur_recue',
        'message_professionnel_nouvelle',
        'reservation_visiteur_rappel',
        'utilisateur_resume_hebdo',
        'utilisateur_rappel_journee',
        'abonnement_rappel',
        'paiement_confirme',
        'utilisateur_suspendu',
        'utilisateur_reactive',
        'utilisateur_jours_offerts',
        'utilisateur_depubliee'
      )) NOT VALID;--> statement-breakpoint
ALTER TABLE "emails_transactionnels" VALIDATE CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint

-- 4. Index. Requêtes réelles : filtre « suspendus » des comptes, tri « plus récents d'abord » de la liste des
--    comptes, recherche par numéro (égalité, D-A2-11), filtre « vitrines bloquées ». Les trois partiels ne
--    contiennent que quelques lignes.
CREATE INDEX IF NOT EXISTS "users_suspendu_idx" ON "users" USING btree ("suspendu") WHERE "users"."suspendu";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_cree_le_idx" ON "users" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_telephone_idx" ON "users" USING btree ("telephone") WHERE "users"."telephone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vitrines_blocage_idx" ON "vitrines" USING btree ("blocage_admin") WHERE "vitrines"."blocage_admin";

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- PERTE : les blocages de vitrines (blocage_admin, blocage_motif : exporter avant, les vitrines bloquées
-- redeviennent visibles si publiee_le est renseignée), l'origine des abonnements (offert / admin), et les
-- lignes d'outbox des 4 types d'e-mail de l'administration. Ordre : index, contrainte des types d'e-mail (après
-- suppression des lignes qui la violeraient), colonnes avec leurs contraintes, puis le journal drizzle
-- (created_at = valeur « when » de l'idx 29 de meta/_journal.json, soit 1794692311875).
-- BEGIN;
-- DROP INDEX IF EXISTS vitrines_blocage_idx;
-- DROP INDEX IF EXISTS users_telephone_idx;
-- DROP INDEX IF EXISTS users_cree_le_idx;
-- DROP INDEX IF EXISTS users_suspendu_idx;
-- DELETE FROM emails_transactionnels WHERE type IN ('utilisateur_suspendu','utilisateur_reactive','utilisateur_jours_offerts','utilisateur_depubliee');
-- ALTER TABLE emails_transactionnels DROP CONSTRAINT IF EXISTS emails_transactionnels_type_check;
-- ALTER TABLE emails_transactionnels ADD CONSTRAINT emails_transactionnels_type_check CHECK (type IN (
--   'reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee',
--   'reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle',
--   'demande_visiteur_recue','message_professionnel_nouvelle','reservation_visiteur_rappel',
--   'utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel','paiement_confirme'));
-- ALTER TABLE abonnements DROP CONSTRAINT IF EXISTS abonnements_origine_check;
-- ALTER TABLE abonnements DROP COLUMN IF EXISTS origine;
-- ALTER TABLE vitrines DROP CONSTRAINT IF EXISTS vitrines_blocage_check;
-- ALTER TABLE vitrines DROP COLUMN IF EXISTS blocage_motif, DROP COLUMN IF EXISTS blocage_admin;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794692311875; -- when de l'idx 29 de meta/_journal.json
-- COMMIT;
