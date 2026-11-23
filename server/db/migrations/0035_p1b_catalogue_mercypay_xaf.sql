-- P1-bis : DONNÉES du catalogue versionné (table configuration_versions, migration 0032) pour la zone XAF de Mercy Pay.
-- Migration de DONNÉES seulement : aucune table, colonne, contrainte ni index.
-- Le code (server/config/paiements.ts, MOYENS_PAIEMENT) déclare quatre moyens ACTIFS de plus : `mercypay:MTN_MOMO_COG`,
-- `mercypay:AIRTEL_COG`, `mercypay:AIRTEL_GAB` et `mercypay:MOOV_GAB`. Or la version active `moyens` / `mercypay` (v1, 0034)
-- ne liste que les deux moyens du Cameroun : le service de lecture (server/services/configuration/lecture.ts,
-- appliquerMoyensActifs) applique la liste `actifs` au catalogue du code et désactive donc tout moyen absent de cette liste.
-- Sans nouvelle version, les quatre nouveaux moyens resteraient inactifs. Cette migration :
--  1. passe la v1 de `moyens` / `mercypay` au statut `remplacee` (seul changement permis par le déclencheur
--     configuration_versions_proteger : contenu figé, `statut` évolue) ;
--  2. insère la v2, `active`, avec les six moyens : les deux du Cameroun (inchangés) et les quatre de la zone XAF.
-- Les frais `mercypay:mobile_money` (v1, 350 points de base, marchand) ne changent pas : un seul barème pour tous les moyens
-- mobile money de Mercy Pay, la clé de frais ne porte pas le moyen. Les lignes `kpay` de 0032 ne sont pas touchées.
-- Fichier drizzle-kit `--custom` (journal et snapshot meta/0035_snapshot.json générés : le snapshot est identique à celui
-- de 0034, le schéma ne change pas) ; le contenu SQL et le bloc ROLLBACK sont écrits à la main.
-- Format repris de 0032 et 0034 : id `a5000000-<categorie>-<cle>-<numero>` (8 à 64 caractères, configuration_versions_id_check),
-- clé `mercypay` conforme à `^[a-z0-9_:.-]{1,60}$`, auteur `systeme`, motif de 5 à 500 caractères. Les valeurs respectent le
-- schéma strict schemaValeursMoyens (shared/schemas/admin-versions.ts) : `actifs` au format MOYEN_ID_FORMAT, sans doublon,
-- 50 au plus ; le service de lecture ignorerait toute ligne invalide. Rappel (D-A5-08) : un moyen ne se CRÉE pas par le
-- catalogue, il active ou désactive un moyen déjà déclaré dans le code ; les six identifiants doivent exister dans
-- MOYENS_PAIEMENT. `effective_a` = date d'application de la migration (comme l'activation par le service : « maintenant »),
-- postérieure à la v1 datée de 2000-01-01.
-- Idempotent et sans écrasement : la v1 n'est remplacée que si elle est encore `active` ET qu'aucune version de numéro 2 ou
-- plus n'existe pour cette clé (brouillon, programmée, active ou remplacée créée par l'administration) ; l'INSERT est gardé
-- par `ON CONFLICT DO NOTHING` (sans cible : unicité de l'id, de (categorie, cle, numero) et de la version active d'une clé)
-- et par l'existence de la v1. Un rejeu ne change donc rien, et le travail de l'administration n'est jamais écrasé ni
-- recréé. Pas de DO $$ : deux instructions simples, une transaction de drizzle-kit migrate les enveloppe.
-- Verrous : un UPDATE d'une ligne et un INSERT d'une table de quelques lignes, aucun verrou long. Le déclencheur
-- configuration_versions_proteger laisse passer l'UPDATE (seul `statut` change) ; l'index unique de la version active est
-- respecté parce que la v1 est remplacée AVANT l'insertion de la v2.

UPDATE "configuration_versions" SET "statut" = 'remplacee'
WHERE "id" = 'a5000000-moyens-mercypay-1' AND "categorie" = 'moyens' AND "cle" = 'mercypay' AND "statut" = 'active'
  AND NOT EXISTS (SELECT 1 FROM "configuration_versions" "suivantes" WHERE "suivantes"."categorie" = 'moyens' AND "suivantes"."cle" = 'mercypay' AND "suivantes"."numero" >= 2);--> statement-breakpoint

INSERT INTO "configuration_versions" ("id","categorie","cle","numero","valeurs","statut","effective_a","motif","cree_par")
SELECT 'a5000000-moyens-mercypay-2','moyens','mercypay',2,
  '{"actifs":["mercypay:MTN_MOMO_CMR","mercypay:ORANGE_CMR","mercypay:MTN_MOMO_COG","mercypay:AIRTEL_COG","mercypay:AIRTEL_GAB","mercypay:MOOV_GAB"]}'::jsonb,
  'active', now(), 'Moyens actifs Mercy Pay, zone XAF : Congo et Gabon (0035)', 'systeme'
WHERE EXISTS (SELECT 1 FROM "configuration_versions" WHERE "id" = 'a5000000-moyens-mercypay-1')
ON CONFLICT DO NOTHING;

-- ROLLBACK (manuel : drizzle-kit n'a pas de « down »). À exécuter dans une transaction, en tant que propriétaire.
-- `configuration_versions` est en ajout seul (déclencheur configuration_versions_proteger : DELETE = 42501) : le retrait de
-- la v2 désactive donc ce déclencheur le temps du DELETE, puis le réactive ; la v1 repasse ensuite à `active` (changement de
-- `statut`, permis avec le déclencheur actif). Le garde-fou REFUSE le retour arrière (transaction annulée) si
-- l'administration a créé une autre version de `moyens` / `mercypay`, si la v2 n'est plus `active` ou si la v1 n'est plus
-- `remplacee` (historique commercial perdu) : exporter d'abord, puis retirer ce bloc sous sa responsabilité.
-- PERTE sinon : la v2 (les quatre moyens Congo et Gabon redeviennent inactifs : le code d'avant 0035 ne les déclare pas, aucun
-- effet) ; la v1 est rétablie telle quelle. Ce retour arrière doit PRÉCÉDER celui de 0034 (son garde-fou refuse tant que la v2
-- existe). Ordre : garde-fou, déclencheur retiré, DELETE de la v2, déclencheur rétabli, v1 réactivée, puis le journal drizzle
-- (created_at = valeur « when » de l'idx 35 de meta/_journal.json, soit 1795424286616).
-- BEGIN;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM configuration_versions WHERE categorie = 'moyens' AND cle = 'mercypay' AND (id NOT IN ('a5000000-moyens-mercypay-1','a5000000-moyens-mercypay-2') OR cree_par <> 'systeme')) OR NOT EXISTS (SELECT 1 FROM configuration_versions WHERE id = 'a5000000-moyens-mercypay-2' AND statut = 'active') OR NOT EXISTS (SELECT 1 FROM configuration_versions WHERE id = 'a5000000-moyens-mercypay-1' AND statut = 'remplacee') THEN RAISE EXCEPTION 'rollback 0035 refuse : les versions Mercy Pay ont ete modifiees ou remplacees (exporter puis retirer ce garde-fou)'; END IF; END $$;
-- ALTER TABLE configuration_versions DISABLE TRIGGER configuration_versions_proteger;
-- DELETE FROM configuration_versions WHERE id = 'a5000000-moyens-mercypay-2';
-- ALTER TABLE configuration_versions ENABLE TRIGGER configuration_versions_proteger;
-- UPDATE configuration_versions SET statut = 'active' WHERE id = 'a5000000-moyens-mercypay-1' AND statut = 'remplacee';
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795424286616; -- when de l'idx 35 de meta/_journal.json
-- COMMIT;
