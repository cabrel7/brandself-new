-- S10 : abonnements, plans et paiement Mobile Money (docs/specs/S10-abonnements.md §2, décisions #103 à #134).
-- Écrite à la main (meta/0021_snapshot.json est le snapshot COMPLET de shared/db/schema.ts, généré par drizzle-kit
-- dans une copie du dossier ; un second `generate` doit répondre « nothing to migrate »).
-- Contenu :
--   paiements            : une tentative de règlement (id = externalId envoyé au fournisseur), snapshot des frais,
--                          numéro du payeur JAMAIS stocké (telephone_masque contient « • », telephone_empreinte = HMAC).
--   abonnements          : une ligne par utilisateur (unique), expire_le exclusif ; l'état actif / grâce / gratuit est
--                          calculé, jamais stocké.
--   evenements_paiement  : journal et déduplication des événements (webhook, interrogation).
--   emails_transactionnels : types abonnement_rappel et paiement_confirme, entités abonnement et paiement,
--                          occurrence obligatoire pour abonnement_rappel.
--   generations_ia       : motif de repli quota_atteint.
-- Rétention (#129) : paiements.user_id et evenements_paiement.paiement_id sont en ON DELETE SET NULL (les pièces
-- comptables survivent à la suppression du compte) ; abonnements.user_id est en CASCADE.
-- Isolation multi-tenant : pas de RLS dans ce projet ; toute lecture est scopée par user_id dans les services
-- (le webhook, lui, retrouve un paiement par id signé). Les FK garantissent la cohérence référentielle.
-- Verrous : tables neuves (aucun verrou sur l'existant). Seuls les DROP/ADD CONSTRAINT de emails_transactionnels
-- et de generations_ia prennent un verrou exclusif bref (ces tables sont petites : l'outbox ne garde que des
-- identifiants, 90 jours au plus ; la liste de valeurs ne fait que S'ÉLARGIR, donc aucune ligne ne peut violer
-- la nouvelle contrainte). CONCURRENTLY est impossible dans la transaction de drizzle, et les index sont créés
-- sur des tables vides. Aucun NOT NULL ajouté à une table existante, aucun backfill, aucune colonne ajoutée.
-- Les listes des CHECK sont recopiées en dur ; leurs sources côté application sont shared/paiements.ts
-- (statuts, supporteurs de frais, formats), shared/plans.ts, shared/jobs.ts (TRANSACTIONAL_EMAIL_TYPES) et
-- shared/ia.ts (MOTIFS_REPLI). Garder synchronisées.
-- COMPATIBILITÉ DE DÉPLOIEMENT : l'ancien code (S9) ne connaît ni ces tables ni ces types et continue de
-- fonctionner après la migration. Le code S10 exige la migration.

CREATE TABLE "abonnements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text DEFAULT 'payant' NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"premiere_activation_le" timestamp with time zone NOT NULL,
	"dernier_paiement_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abonnements_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "abonnements_plan_check" CHECK ("abonnements"."plan" ~ '^[a-z_]{1,30}$' AND "abonnements"."plan" <> 'gratuit'),
	CONSTRAINT "abonnements_dates_check" CHECK ("abonnements"."premiere_activation_le" < "abonnements"."expire_le")
);
--> statement-breakpoint
CREATE TABLE "evenements_paiement" (
	"id" text PRIMARY KEY NOT NULL,
	"fournisseur" text NOT NULL,
	"evenement" text NOT NULL,
	"source" text NOT NULL,
	"id_transaction" text NOT NULL,
	"external_id" text,
	"paiement_id" text,
	"statut_fournisseur" text,
	"montant" integer,
	"traitement" text NOT NULL,
	"motif" text,
	"horodatage_fournisseur" timestamp with time zone,
	"recu_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evenements_paiement_fournisseur_check" CHECK ("evenements_paiement"."fournisseur" ~ '^[a-z0-9_-]{1,40}$'),
	CONSTRAINT "evenements_paiement_evenement_check" CHECK ("evenements_paiement"."evenement" ~ '^[a-z_]{1,20}\.[a-z_]{1,20}$'),
	CONSTRAINT "evenements_paiement_source_check" CHECK ("evenements_paiement"."source" IN ('webhook','interrogation')),
	CONSTRAINT "evenements_paiement_ids_check" CHECK (char_length("evenements_paiement"."id_transaction") BETWEEN 1 AND 100
        AND ("evenements_paiement"."external_id" IS NULL OR char_length("evenements_paiement"."external_id") <= 100)),
	CONSTRAINT "evenements_paiement_statut_check" CHECK ("evenements_paiement"."statut_fournisseur" IS NULL OR "evenements_paiement"."statut_fournisseur" ~ '^[A-Z_]{1,30}$'),
	CONSTRAINT "evenements_paiement_traitement_check" CHECK ("evenements_paiement"."traitement" IN ('applique','ignore','anomalie')),
	CONSTRAINT "evenements_paiement_motif_check" CHECK ("evenements_paiement"."motif" IS NULL OR "evenements_paiement"."motif" ~ '^[A-Z0-9_]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "paiements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"fournisseur" text NOT NULL,
	"methode" text NOT NULL,
	"operateur" text,
	"environnement" text NOT NULL,
	"id_fournisseur" text,
	"reference_fournisseur" text,
	"statut" text DEFAULT 'cree' NOT NULL,
	"plan" text NOT NULL,
	"periode_mois" smallint NOT NULL,
	"devise" text NOT NULL,
	"montant_plan" integer NOT NULL,
	"montant" integer NOT NULL,
	"frais_taux_pb" integer NOT NULL,
	"frais_supporteur" text NOT NULL,
	"frais_estimes" integer NOT NULL,
	"net_estime" integer NOT NULL,
	"frais_reels" integer,
	"net_reel" integer,
	"telephone_masque" text,
	"telephone_empreinte" text,
	"code_echec" text,
	"initiation_incertaine" boolean DEFAULT false NOT NULL,
	"expire_avant" timestamp with time zone NOT NULL,
	"prochaine_verification" timestamp with time zone,
	"verifications" smallint DEFAULT 0 NOT NULL,
	"applique_le" timestamp with time zone,
	"abonnement_expire_avant" timestamp with time zone,
	"abonnement_expire_apres" timestamp with time zone,
	"termine_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paiements_fournisseur_check" CHECK ("paiements"."fournisseur" ~ '^[a-z0-9_-]{1,40}$'),
	CONSTRAINT "paiements_methode_check" CHECK ("paiements"."methode" ~ '^[a-z_]{1,30}$'),
	CONSTRAINT "paiements_operateur_check" CHECK ("paiements"."operateur" IS NULL OR "paiements"."operateur" ~ '^[A-Z0-9_]{2,40}$'),
	CONSTRAINT "paiements_environnement_check" CHECK ("paiements"."environnement" IN ('test','live')),
	CONSTRAINT "paiements_statut_check" CHECK ("paiements"."statut" IN ('cree','en_attente','reussi','echoue','annule','expire','anomalie')),
	CONSTRAINT "paiements_plan_check" CHECK ("paiements"."plan" ~ '^[a-z_]{1,30}$' AND "paiements"."plan" <> 'gratuit'),
	CONSTRAINT "paiements_periode_check" CHECK ("paiements"."periode_mois" BETWEEN 1 AND 36),
	CONSTRAINT "paiements_devise_check" CHECK ("paiements"."devise" ~ '^[A-Z]{3}$'),
	CONSTRAINT "paiements_montants_check" CHECK ("paiements"."montant_plan" > 0 AND "paiements"."montant" >= "paiements"."montant_plan" AND "paiements"."montant" <= 1000000000
        AND "paiements"."frais_estimes" >= 0 AND "paiements"."net_estime" = "paiements"."montant" - "paiements"."frais_estimes"
        AND ("paiements"."frais_reels" IS NULL OR "paiements"."frais_reels" >= 0) AND ("paiements"."net_reel" IS NULL OR "paiements"."net_reel" >= 0)),
	CONSTRAINT "paiements_frais_taux_check" CHECK ("paiements"."frais_taux_pb" BETWEEN 0 AND 5000),
	CONSTRAINT "paiements_frais_supporteur_check" CHECK ("paiements"."frais_supporteur" IN ('marchand','client')),
	CONSTRAINT "paiements_telephone_masque_check" CHECK ("paiements"."telephone_masque" IS NULL
        OR (char_length("paiements"."telephone_masque") <= 32 AND position('•' in "paiements"."telephone_masque") > 0)),
	CONSTRAINT "paiements_telephone_empreinte_check" CHECK ("paiements"."telephone_empreinte" IS NULL OR "paiements"."telephone_empreinte" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "paiements_code_echec_check" CHECK ("paiements"."code_echec" IS NULL OR "paiements"."code_echec" ~ '^[A-Z0-9_]{1,64}$'),
	CONSTRAINT "paiements_ids_check" CHECK (("paiements"."id_fournisseur" IS NULL OR char_length("paiements"."id_fournisseur") BETWEEN 1 AND 100)
        AND ("paiements"."reference_fournisseur" IS NULL OR char_length("paiements"."reference_fournisseur") BETWEEN 1 AND 100)),
	CONSTRAINT "paiements_applique_check" CHECK (("paiements"."statut" = 'reussi') = ("paiements"."applique_le" IS NOT NULL)),
	CONSTRAINT "paiements_terminal_check" CHECK (("paiements"."statut" IN ('cree','en_attente')) = ("paiements"."termine_le" IS NULL)),
	CONSTRAINT "paiements_attente_id_check" CHECK ("paiements"."statut" <> 'en_attente' OR "paiements"."id_fournisseur" IS NOT NULL OR "paiements"."initiation_incertaine"),
	CONSTRAINT "paiements_verifications_check" CHECK ("paiements"."verifications" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_occurrence_requise_check";--> statement-breakpoint
ALTER TABLE "generations_ia" DROP CONSTRAINT "generations_ia_motif_check";--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_dernier_paiement_id_paiements_id_fk" FOREIGN KEY ("dernier_paiement_id") REFERENCES "public"."paiements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_paiement" ADD CONSTRAINT "evenements_paiement_paiement_id_paiements_id_fk" FOREIGN KEY ("paiement_id") REFERENCES "public"."paiements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abonnements_expire_le_idx" ON "abonnements" USING btree ("expire_le");--> statement-breakpoint
CREATE INDEX "abonnements_dernier_paiement_idx" ON "abonnements" USING btree ("dernier_paiement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_paiement_dedup_unique" ON "evenements_paiement" USING btree ("fournisseur","id_transaction","evenement");--> statement-breakpoint
CREATE INDEX "evenements_paiement_paiement_idx" ON "evenements_paiement" USING btree ("paiement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paiements_fournisseur_id_unique" ON "paiements" USING btree ("fournisseur","id_fournisseur") WHERE "paiements"."id_fournisseur" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "paiements_fournisseur_reference_unique" ON "paiements" USING btree ("fournisseur","reference_fournisseur") WHERE "paiements"."reference_fournisseur" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "paiements_user_created_idx" ON "paiements" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "paiements_ouverts_idx" ON "paiements" USING btree ("user_id") WHERE "paiements"."statut" IN ('cree','en_attente');--> statement-breakpoint
CREATE INDEX "paiements_a_verifier_idx" ON "paiements" USING btree ("prochaine_verification") WHERE "paiements"."statut" IN ('cree','en_attente');--> statement-breakpoint
CREATE INDEX "paiements_telephone_idx" ON "paiements" USING btree ("telephone_empreinte","created_at") WHERE "paiements"."telephone_empreinte" IS NOT NULL;--> statement-breakpoint
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
        'paiement_confirme'
      ));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check" CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande', 'message', 'utilisateur', 'abonnement', 'paiement'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%')
        OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%')
        OR ("emails_transactionnels"."entite_type" = 'message' AND "emails_transactionnels"."type" LIKE 'message_%')
        OR ("emails_transactionnels"."entite_type" = 'utilisateur' AND "emails_transactionnels"."type" LIKE 'utilisateur_%')
        OR ("emails_transactionnels"."entite_type" = 'abonnement' AND "emails_transactionnels"."type" LIKE 'abonnement_%')
        OR ("emails_transactionnels"."entite_type" = 'paiement' AND "emails_transactionnels"."type" LIKE 'paiement_%'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_requise_check" CHECK ("emails_transactionnels"."type" NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel')
        OR "emails_transactionnels"."occurrence" <> '');--> statement-breakpoint
ALTER TABLE "generations_ia" ADD CONSTRAINT "generations_ia_motif_check" CHECK ("generations_ia"."motif_repli" IS NULL OR "generations_ia"."motif_repli" IN (
        'echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur',
        'sans_prompt','file_indisponible','limiteur_indisponible','plafond_global','quota_atteint'));

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans UNE transaction, dans cet ordre.
-- REFUSÉ si un paiement `live` existe (pièce comptable : le premier instruction lève une exception et la
-- transaction est annulée en entier). Perte, assumée : (1) toutes les lignes de paiements `test`, d'abonnements
-- et d'evenements_paiement (tables supprimées) ; (2) les lignes d'outbox des entités abonnement et paiement ;
-- (3) le motif `quota_atteint` des générations IA est réécrit en `plafond_global` (même statut `repli`).
-- ATTENTION : le rollback ÉCHOUE (la transaction est annulée en entier, rien n'est modifié) dans ces cas :
--   a) exception « paiements live présents » : voulu, ne pas contourner sans validation comptable ;
--   b) 23514 (check_violation) à l'ADD CONSTRAINT d'une ancienne CHECK : il reste une ligne d'un type ou d'une
--      entité que l'ancienne liste ne connaît pas (le DELETE est censé les retirer toutes ; une ligne insérée
--      entre-temps par un worker encore démarré les fait réapparaître : ARRÊTER le worker et l'application
--      avant le rollback) ;
--   c) la migration doit avoir été appliquée en entier (les noms de contraintes et de tables supprimés doivent
--      exister, sinon 42704 / 42P01).
-- Le code S10 ne fonctionne plus après ce rollback (tables manquantes) : redéployer le code antérieur.
-- Vérifier avant : SELECT "environnement", "statut", count(*) FROM "paiements" GROUP BY 1, 2;
-- Ne s'applique que si le journal est à l'idx 21 : created_at = valeur « when » de meta/_journal.json (idx 21),
-- soit 1793700141133.
-- BEGIN;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM "paiements" WHERE "environnement" = 'live') THEN RAISE EXCEPTION 'paiements live presents : rollback interdit'; END IF; END $$;
-- UPDATE "generations_ia" SET "motif_repli" = 'plafond_global' WHERE "motif_repli" = 'quota_atteint';
-- ALTER TABLE "generations_ia" DROP CONSTRAINT "generations_ia_motif_check";
-- ALTER TABLE "generations_ia" ADD CONSTRAINT "generations_ia_motif_check" CHECK ("generations_ia"."motif_repli" IS NULL OR "generations_ia"."motif_repli" IN ('echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur','sans_prompt','file_indisponible','limiteur_indisponible','plafond_global'));
-- DELETE FROM "emails_transactionnels" WHERE "entite_type" IN ('abonnement','paiement') OR "type" IN ('abonnement_rappel','paiement_confirme');
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_occurrence_requise_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_requise_check" CHECK ("emails_transactionnels"."type" NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee') OR "emails_transactionnels"."occurrence" <> '');
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%') OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%') OR ("emails_transactionnels"."entite_type" = 'message' AND "emails_transactionnels"."type" LIKE 'message_%') OR ("emails_transactionnels"."entite_type" = 'utilisateur' AND "emails_transactionnels"."type" LIKE 'utilisateur_%'));
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check" CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande', 'message', 'utilisateur'));
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";
-- ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("emails_transactionnels"."type" IN ('reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee','reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle','demande_visiteur_recue','message_professionnel_nouvelle','reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee'));
-- DROP TABLE "evenements_paiement";
-- DROP TABLE "abonnements";
-- DROP TABLE "paiements";
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793700141133; -- when de l'idx 21 de meta/_journal.json
-- COMMIT;
