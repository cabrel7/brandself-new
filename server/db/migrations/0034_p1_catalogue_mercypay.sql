-- P1 (docs/specs/P1-mercypay.md §4.3) : DONNÉES du catalogue versionné (table configuration_versions, migration 0032) pour
-- le second fournisseur de paiement, Mercy Pay. Migration de DONNÉES seulement : aucune table, colonne, contrainte ni index.
--  1. moyens / `mercypay` v1 : moyens actifs `mercypay:MTN_MOMO_CMR` et `mercypay:ORANGE_CMR` ;
--  2. frais / `mercypay:mobile_money` v1 : 350 points de base (3,5 %), supportés par le marchand.
-- Les lignes `kpay` de 0032 ne sont PAS touchées : K-PAY est désactivé par l'absence de clés d'API, pas par le catalogue.
-- Fichier drizzle-kit `--custom` (journal et snapshot meta/0034_snapshot.json générés : le snapshot est identique à celui
-- de 0033, le schéma ne change pas) ; le contenu SQL et le bloc ROLLBACK sont écrits à la main.
-- Format repris de 0032 : id `a5000000-<categorie>-<cle>-1` (8 à 64 caractères, configuration_versions_id_check), clé
-- conforme à `^[a-z0-9_:.-]{1,60}$`, auteur `systeme`, effective_a 2000-01-01, motif de 5 à 500 caractères. Les valeurs
-- respectent les schémas stricts de shared/schemas/admin-versions.ts (schemaValeursFrais : tauxPointsBase + supporteur ;
-- schemaValeursMoyens : actifs au format MOYEN_ID_FORMAT) : le service de lecture (server/services/configuration/lecture.ts)
-- ignorerait toute ligne invalide. Rappel (D-A5-08) : un moyen ne se CRÉE pas par le catalogue, il active ou désactive un
-- moyen déjà déclaré dans le code (server/config/paiements.ts, MOYENS_PAIEMENT) ; le code doit donc déclarer
-- `mercypay:MTN_MOMO_CMR` et `mercypay:ORANGE_CMR`, sans quoi cette version n'a aucun effet.
-- Idempotent : `ON CONFLICT DO NOTHING` (sans cible : unicité de l'id, de (categorie, cle, numero) et de la version active
-- d'une clé). Une version déjà remplacée par l'administration n'est jamais recréée ni écrasée ; si l'administration a déjà
-- une version active pour l'une de ces clés, la ligne n'est pas insérée.
-- Verrous : deux INSERT d'une table de quelques lignes, aucun verrou long. Le déclencheur configuration_versions_proteger
-- ne se déclenche pas sur INSERT.

INSERT INTO "configuration_versions" ("id","categorie","cle","numero","valeurs","statut","effective_a","motif","cree_par") VALUES
 ('a5000000-moyens-mercypay-1','moyens','mercypay',1,'{"actifs":["mercypay:MTN_MOMO_CMR","mercypay:ORANGE_CMR"]}','active','2000-01-01T00:00:00Z','Moyens actifs initiaux Mercy Pay (0034)','systeme'),
 ('a5000000-frais-mercypay-mobile-money-1','frais','mercypay:mobile_money',1,'{"tauxPointsBase":350,"supporteur":"marchand"}','active','2000-01-01T00:00:00Z','Frais initiaux Mercy Pay (0034)','systeme')
ON CONFLICT DO NOTHING;

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- `configuration_versions` est en ajout seul (déclencheur configuration_versions_proteger : DELETE = 42501) : le retrait
-- désactive donc ce déclencheur le temps du DELETE, puis le réactive. Le garde-fou REFUSE le retour arrière (transaction
-- annulée) si l'administration a créé une autre version de l'une de ces deux clés, ou si l'une des deux lignes d'origine
-- n'est plus `active` (historique commercial perdu) : exporter d'abord, puis retirer ce bloc sous sa responsabilité.
-- PERTE sinon : les deux lignes insérées ; le code d'avant 0034 relit les valeurs du code (aucun effet). Ordre :
-- garde-fou, déclencheur retiré, DELETE, déclencheur rétabli, puis le journal drizzle (created_at = valeur « when » de
-- l'idx 34 de meta/_journal.json, soit 1794967170386).
-- BEGIN;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM configuration_versions WHERE ((categorie = 'moyens' AND cle = 'mercypay') OR (categorie = 'frais' AND cle = 'mercypay:mobile_money')) AND (id NOT IN ('a5000000-moyens-mercypay-1','a5000000-frais-mercypay-mobile-money-1') OR statut <> 'active' OR cree_par <> 'systeme')) THEN RAISE EXCEPTION 'rollback 0034 refuse : les versions Mercy Pay ont ete modifiees ou remplacees (exporter puis retirer ce garde-fou)'; END IF; END $$;
-- ALTER TABLE configuration_versions DISABLE TRIGGER configuration_versions_proteger;
-- DELETE FROM configuration_versions WHERE id IN ('a5000000-moyens-mercypay-1','a5000000-frais-mercypay-mobile-money-1');
-- ALTER TABLE configuration_versions ENABLE TRIGGER configuration_versions_proteger;
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794967170386; -- when de l'idx 34 de meta/_journal.json
-- COMMIT;
