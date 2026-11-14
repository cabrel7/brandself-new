# Spec A5 — Configuration commerciale : catalogues et versions (tier critique)

Source : brief `docs/specs/sprints-admin-A1-A5.md` (COMPLÉMENT ADMIN et A5). Migration : `0032_a5_catalogues_versions` (0028 à 0031 réservées). Dépend de A1 (`requireSuperadmin`, `Audit.enregistrer`, `exigerReauth`), A2 (prédicat `sqlVitrinePublique()`, `journal_admin.cle_idempotence`) et A3 (`confirmerPaiement`). A4 n'a pas de spec dans le dépôt : A5 n'utilise PAS le registre des réglages (une valeur commerciale est versionnée, ce n'est pas un réglage).

## 1. CHALLENGE

- **Hypothèses implicites.** Le brief suppose que le serveur reçoit « le montant vu par le client ». Aujourd'hui NON : `initierPaiement` calcule le prix lui-même (`server/services/paiements/initiation.ts:156`) et le client n'envoie aucun montant. La règle 409 est donc un changement de contrat de l'API d'initiation (champ `prixAffiche` obligatoire) et impose de modifier le front dans le même sprint.
- **Angles morts.** (a) Le SMS n'est pas branché : `SenderOtpSms` lève `OTP_SMS_NON_CONFIGURE` en production (`server/services/otp/envoi.ts:72`). Un drapeau « SMS actif » ne change rien tant qu'il n'y a pas de fournisseur ; l'interface doit l'indiquer. (b) WhatsApp n'a aucun fournisseur (`envoi.ts:78-84`) : le drapeau est inopérant. (c) L'indicatif n'est pas unique (`+1` pour le Canada et les États-Unis) : le canal par pays est ambigu. (d) Le fuseau `Africa/Douala` est en dur hors des modules déjà listés (`server/services/statistiques.ts:155,204`, `server/services/liens.ts:246`). (e) `PRIX_STATUT` est lu de façon synchrone au démarrage (`server/plugins/config-paiements.ts`) : il faut un chargement asynchrone.
- **Meilleure approche.** Un seul service `Versions` avec un adaptateur par type, chacun avec son schéma Zod strict. Pas de moteur générique de schémas. Les lectures qui décident d'un encaissement ne passent pas par le cache.
- **À retirer / simplifier.** Création de plans, de devises et de pays depuis l'interface (hors périmètre, déjà refusé par le brief). Fuseaux traités comme un champ du pays, pas comme un quatrième catalogue. Pas d'édition des clés de capacités.
- **Périmètre réel.** Plus large que le brief : onboarding (liste des pays), page de connexion (`app/pages/connexion/index.vue:40-63`, liste de canaux et indicatifs en dur), `server/auth.config.ts:205-217` (SMS), `shared/schemas/moi.ts:8-9`, `server/resources/vitrine.ts:23`, `server/services/ia/nettoyage.ts:112`, `server/resources/agenda.ts:52`, `/tarifs` (`server/services/abonnements.ts:64`), sitemap (`server/services/seo-sitemap.ts:53`), statistiques (`server/services/statistiques.ts:195`), visibilité (`server/services/plan-visibilite.ts:41`).

## 2. État des lieux (vérifié)

- Plans : `PLANS` `server/config/plans.ts:22-43` ; `LIMITE_CHAMP_PAR_RESSOURCE` `:46-53` ; `PRIX_STATUT` `:66` (`a_valider`) ; `PRIX_PLANS` `:75-81`. `shared/plans.ts:8` (`PLAN_IDS`), `:84` (`CAPACITES_PAYANTES = ['mcp']`), `:49` (fuseau de repli). `limiteDe` `server/services/plans.ts:135-137` est le seul lecteur de quotas ; lectures directes de `PLANS` : `plan-visibilite.ts:41`, `statistiques.ts:195`, `seo-sitemap.ts:53`, `abonnements.ts:36,64`.
- Prix : `offre.ts:50` et `initiation.ts:156` lisent `PRIX_PLANS` ; `paiementVerrouille` `server/config/paiements.ts:181` ; `assertConfigPaiements` `:236-282`. Le webhook compare le montant reçu au montant du paiement : `server/services/paiements/application.ts:88` (`MONTANT_INCOHERENT`). Les paiements gardent un instantané : `montant_plan`, `montant`, `frais_taux_pb`, `frais_supporteur` (`shared/db/schema.ts:1246-1270`).
- Frais : `FRAIS_PAIEMENT` `server/config/paiements.ts:44-46` (kpay / mobile_money : 500 pb, `marchand`) ; `getFraisPaiement` `:54`. Moyens : `MOYENS_PAIEMENT` `:52` (actifs : `kpay:MTN_MOMO_CMR`, `kpay:ORANGE_CMR`).
- Devises : `DEVISES` `shared/compte.ts:4` (type `Devise`, à garder). `DEVISE_DECIMALES` `shared/devises.ts:4`. `DEVISES_EXPOSANT` `shared/paiements.ts:34` (inclut XOF). Zod : `shared/schemas/moi.ts:8`, `shared/schemas/service.ts:68`, `server/resources/utilisateur.ts:16`. Décimales et affichage restent dans le code.
- Pays : `PAYS` `shared/vitrine.ts:18-49` (30 entrées, sans indicatif), `PAYS_CODES` `:51`, Zod `shared/schemas/onboarding.ts:17` et `shared/schemas/vitrine.ts:55`. Colonne `vitrines.pays` (`shared/db/schema.ts:159`), sans clé étrangère.
- Fuseau : `isValidTimeZone` `shared/fuseau.ts:1`. `users.fuseau` défaut `Africa/Douala` (`schema.ts:36`, `server/auth.config.ts:178`).
- Noms réservés : `shared/reserved.ts:1-33`, `isReserved` `:35`. Les appels de `isReserved` ne sont pas inventoriés ici : le backend les lit tous.
- Prompts : table `prompts_ia` `shared/db/schema.ts:721-749` (index unique partiel `actif` `:738`, CHECK type à trois valeurs) ; `generations_ia.prompt_id` en `ON DELETE RESTRICT` (migration 0018 l.99). Variables autorisées `server/services/ia/prompts.ts:20` (`['donnees']`), schémas par type `:23-27`, `renderGabarit` `:43`, `lirePrompt` `:71-91`, `getActivePrompt` `:94`. Contrôles en code `server/services/ia/verification.ts:118,161,194,238,266,329`. Migration 0027 : v1 désactivée, v2 `onboarding_vitrine` active ; la présence d'une ligne `seo_vitrine` n'est pas vérifiée (à contrôler par le database).

## 3. Décisions (défaut appliqué ; ⚠️ = à trancher par l'utilisateur)

- **D-A5-01** Un seul mécanisme de version : table `configuration_versions` pour `plan`, `prix`, `frais`, `moyens` (pas de `plan_versions` séparée). Les prompts restent dans `prompts_ia` (historique référencé par `generations_ia`), pilotés par un adaptateur.
- **D-A5-02** Statuts : `brouillon` → `programmee` | `active` → `remplacee`. Une seule `active` et une seule `programmee` par `(categorie, cle)`, par index partiels. Une version n'est jamais supprimée ; seuls `statut` et `validee_le` sont modifiables (trigger).
- **D-A5-03** Date d'effet : un job `versions-appliquer` (file `maintenance`, toutes les 60 s, idempotent : `UPDATE … WHERE statut='programmee' AND effective_a <= now()`) fait passer la version à `active`. Délai maximal : 60 s après la date.
- **D-A5-04** Lectures : cache mémoire de 5 s pour `PlanService`, frais, moyens et catalogues (worker compris). Sans cache, et lues dans la transaction : `assertQuota` (verrou), `initierPaiement` (prix), `paiementVerrouille`. Erreur de lecture : repli sur les constantes du code (qui valent la v1 seedée). Le repli du prix est « verrouillé » (`validee=false`), jamais « ouvert ».
- **D-A5-05** Plans : valeurs validées par `.strict()` avec les clés de `ConfigPlan` plus `capacites: { mcp }`. Bornes : entiers 0 à 10 000 ou `null` (illimité) ; un plan gratuit n'est jamais illimité ; limite gratuit ≤ limite payant. Aucune création de plan (`plan` ∈ `PLAN_IDS`).
- **D-A5-06** Impact : `POST /api/admin/versions/plans/impact` calcule l'aperçu (SQL ci-dessous). L'activation d'une baisse exige `impactAcquitte` égal au calcul au moment de l'activation, sinon 409 `IMPACT_CHANGE`. Rien n'est supprimé ni modifié dans les contenus.
- **D-A5-07** Prix : une version = la grille complète (3 devises × 1, 3, 12 mois). Activer un prix = le valider (`validee_le` posé dans la même transaction, réauthentifiée). La version seedée n'est PAS validée : la production reste verrouillée, comme aujourd'hui. `POST …/valider` valide la version active sans changer de grille. Le client envoie `prixAffiche` (montant TTC affiché) ; le serveur recalcule `calculerMontants` ; écart → 409 `PRIX_CHANGE` avec le nouveau montant.
- **D-A5-08** Frais et moyens : versions indépendantes ; le snapshot de chaque paiement reste intact. Moyens : seul le drapeau `actif` change ; un moyen ne se crée pas depuis l'interface (il dépend d'un code d'opérateur).
- **D-A5-09** Prompts : éditer = nouvelle ligne `prompts_ia` (`actif=false`) ; `systeme`, `gabarit`, `parametres`, `variables`, `schema_sortie` sont figés après création (trigger). Le serveur calcule `variables` depuis le gabarit et refuse toute variable hors `VARIABLES_AUTORISEES`. Activation : désactiver l'ancienne et activer la nouvelle dans la même transaction. Retour : réactiver la précédente, après revalidation par `lirePrompt`. Essai à blanc : entrées synthétiques figées dans le code (`server/services/ia/essai-fixtures.ts`), 10 essais par heure et par admin (Redis), aucune ligne persistée. Comparaison : `generations_ia` groupé par `prompt_id`.
- **D-A5-10** Catalogues : `pays` (clé = code alpha-2), `devises` (codes fixés à `XAF`, `EUR`, `USD`, drapeau `actif`), `usernames_bloques`. ⚠️ Pays créés par migration seulement, pas depuis l'interface (un pays exige un indicatif, des fuseaux et un format de numéro). Suppression d'un pays : refusée (409 `CATALOGUE_ENTREE_UTILISEE`) dès qu'une `vitrines.pays` le référence ; sinon autorisée. Pas de clé étrangère sur `vitrines.pays` (évite un échec de migration sur des valeurs historiques).
- **D-A5-11** Devise « active » ≠ « payable » : `actif` contrôle ce qu'un compte peut choisir ; « payable » reste calculé par `construireOffre` (moyen actif + fournisseur configuré). Ne pas afficher EUR ou USD comme payables tant que `offre.ts` ne les accepte pas.
- **D-A5-12** Fuseaux : champ `fuseaux text[]` du pays, validé par `isValidTimeZone` et `Intl.supportedValuesOf('timeZone')`. Les fuseaux déjà enregistrés restent valides ; le contrôle ne s'applique qu'au changement de valeur.
- **D-A5-13** Canaux : `canal_sms` et `canal_whatsapp` sont appliqués côté serveur dans `sendOTP` (indicatif → pays le plus précis) : refus `CANAL_INDISPONIBLE` (422) avant mise en file. Le canal effectif = drapeau ET fournisseur configuré (donc WhatsApp = inactif). ⚠️ `canal_email` n'a pas d'effet sur la connexion par e-mail (qui ne connaît pas le pays) : colonne informative, sans effet. ⚠️ Pour `+1` (CA et US), le plus restrictif s'applique.
- **D-A5-14** Journal : `Audit.enregistrer` dans la transaction de chaque écriture. `avant`/`apres` plats (conformes à A1) : identifiant de version, catégorie, clé, numéro, statut, et empreinte SHA-256 des valeurs. Le contenu des valeurs est dans `configuration_versions`, lui aussi append-only.
- **D-A5-15** Lecture publique hors admin : `GET /api/referentiels` (pays actifs avec indicatif, fuseaux, canaux effectifs, devises actives), cache 60 s, sans donnée admin. ⚠️ Route hors brief, nécessaire à la page de connexion et à l'onboarding.
- **D-A5-16** Idempotence : header `Idempotency-Key` (8 à 128 caractères) sur toute écriture. Rejeu : relecture de la ligne journalisée (`journal_admin.cle_idempotence`), pas de second effet.
- **D-A5-17** Concurrence : chaque écriture prend `pg_advisory_xact_lock(hashtextextended('config:'||categorie||':'||cle, 0))`.

## 4. Modèle de données — migration `0032_a5_catalogues_versions.sql`

```sql
CREATE TABLE IF NOT EXISTS "devises" (
  "code" text PRIMARY KEY CHECK ("code" IN ('XAF','EUR','USD')),
  "actif" boolean NOT NULL DEFAULT true,
  "modifie_le" timestamp with time zone NOT NULL DEFAULT now()
);
INSERT INTO "devises" ("code","actif") VALUES ('XAF',true),('EUR',true),('USD',true) ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "pays" (
  "code" text PRIMARY KEY CHECK ("code" ~ '^[A-Z]{2}$'),
  "libelle" text NOT NULL CHECK (char_length("libelle") BETWEEN 2 AND 80),
  "indicatif" text NOT NULL CHECK ("indicatif" ~ '^[1-9][0-9]{0,3}$'),
  "actif" boolean NOT NULL DEFAULT true,
  "devise_defaut" text NOT NULL REFERENCES "devises"("code"),
  "fuseaux" text[] NOT NULL CHECK (cardinality("fuseaux") >= 1),
  "canal_sms" boolean NOT NULL DEFAULT true,
  "canal_whatsapp" boolean NOT NULL DEFAULT false,
  "canal_email" boolean NOT NULL DEFAULT true,
  "modifie_le" timestamp with time zone NOT NULL DEFAULT now()
);
-- Seed : les 30 entrées de shared/vitrine.ts:18-49 (indicatifs et fuseaux : PROPOSITION, ⚠️ à valider par le database).
INSERT INTO "pays" ("code","libelle","indicatif","devise_defaut","fuseaux") VALUES
 ('CM','Cameroun','237','XAF',ARRAY['Africa/Douala']),
 ('SN','Sénégal','221','XAF',ARRAY['Africa/Dakar']),
 ('CI','Côte d’Ivoire','225','XAF',ARRAY['Africa/Abidjan']),
 ('GA','Gabon','241','XAF',ARRAY['Africa/Libreville']),
 ('CG','Congo','242','XAF',ARRAY['Africa/Brazzaville']),
 ('CD','République démocratique du Congo','243','USD',ARRAY['Africa/Kinshasa','Africa/Lubumbashi']),
 ('BJ','Bénin','229','XAF',ARRAY['Africa/Porto-Novo']),
 ('TG','Togo','228','XAF',ARRAY['Africa/Lome']),
 ('BF','Burkina Faso','226','XAF',ARRAY['Africa/Ouagadougou']),
 ('ML','Mali','223','XAF',ARRAY['Africa/Bamako']),
 ('NE','Niger','227','XAF',ARRAY['Africa/Niamey']),
 ('TD','Tchad','235','XAF',ARRAY['Africa/Ndjamena']),
 ('CF','République centrafricaine','236','XAF',ARRAY['Africa/Bangui']),
 ('GN','Guinée','224','USD',ARRAY['Africa/Conakry']),
 ('MG','Madagascar','261','USD',ARRAY['Indian/Antananarivo']),
 ('RW','Rwanda','250','USD',ARRAY['Africa/Kigali']),
 ('BI','Burundi','257','USD',ARRAY['Africa/Bujumbura']),
 ('DJ','Djibouti','253','USD',ARRAY['Africa/Djibouti']),
 ('KM','Comores','269','USD',ARRAY['Indian/Comoro']),
 ('FR','France','33','EUR',ARRAY['Europe/Paris']),
 ('BE','Belgique','32','EUR',ARRAY['Europe/Brussels']),
 ('CH','Suisse','41','EUR',ARRAY['Europe/Zurich']),
 ('CA','Canada','1','USD',ARRAY['America/Toronto']),
 ('LU','Luxembourg','352','EUR',ARRAY['Europe/Luxembourg']),
 ('MA','Maroc','212','USD',ARRAY['Africa/Casablanca']),
 ('TN','Tunisie','216','USD',ARRAY['Africa/Tunis']),
 ('DZ','Algérie','213','USD',ARRAY['Africa/Algiers']),
 ('US','États-Unis','1','USD',ARRAY['America/New_York']),
 ('GB','Royaume-Uni','44','EUR',ARRAY['Europe/London']),
 ('DE','Allemagne','49','EUR',ARRAY['Europe/Berlin'])
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "usernames_bloques" (
  "valeur" text PRIMARY KEY CHECK ("valeur" ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  "motif" text NOT NULL CHECK (char_length(btrim("motif")) BETWEEN 5 AND 200),
  "cree_par" text NOT NULL CHECK (char_length("cree_par") <= 64),
  "cree_le" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "configuration_versions" (
  "id" text PRIMARY KEY CHECK (char_length("id") BETWEEN 8 AND 64),
  "categorie" text NOT NULL CHECK ("categorie" IN ('plan','prix','frais','moyens')),
  "cle" text NOT NULL CHECK ("cle" ~ '^[a-z0-9_:.-]{1,60}$'),
  "numero" integer NOT NULL CHECK ("numero" >= 1),
  "valeurs" jsonb NOT NULL CHECK (jsonb_typeof("valeurs") = 'object'),
  "statut" text NOT NULL CHECK ("statut" IN ('brouillon','programmee','active','remplacee')),
  "effective_a" timestamp with time zone,
  "validee_le" timestamp with time zone,
  "motif" text NOT NULL CHECK (char_length(btrim("motif")) BETWEEN 5 AND 500),
  "cree_par" text NOT NULL CHECK (char_length("cree_par") <= 64),
  "cree_le" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "configuration_versions_numero_unique" UNIQUE ("categorie","cle","numero"),
  CONSTRAINT "configuration_versions_plan_cle_check" CHECK ("categorie" <> 'plan' OR "cle" IN ('gratuit','payant')),
  CONSTRAINT "configuration_versions_effet_check" CHECK (("statut" = 'brouillon') = ("effective_a" IS NULL)),
  CONSTRAINT "configuration_versions_validee_check" CHECK ("validee_le" IS NULL OR "categorie" = 'prix')
);
CREATE UNIQUE INDEX IF NOT EXISTS "configuration_versions_active_unique" ON "configuration_versions" ("categorie","cle") WHERE "statut" = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS "configuration_versions_programmee_unique" ON "configuration_versions" ("categorie","cle") WHERE "statut" = 'programmee';

CREATE OR REPLACE FUNCTION configuration_versions_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'configuration_versions : suppression interdite' USING ERRCODE = '42501';
  END IF;
  IF (NEW.valeurs, NEW.categorie, NEW.cle, NEW.numero, NEW.motif, NEW.cree_par, NEW.cree_le)
     IS DISTINCT FROM (OLD.valeurs, OLD.categorie, OLD.cle, OLD.numero, OLD.motif, OLD.cree_par, OLD.cree_le)
     OR (OLD.effective_a IS NOT NULL AND NEW.effective_a IS DISTINCT FROM OLD.effective_a)
     OR (OLD.validee_le IS NOT NULL AND NEW.validee_le IS DISTINCT FROM OLD.validee_le) THEN
    RAISE EXCEPTION 'configuration_versions : contenu figé' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS configuration_versions_proteger ON "configuration_versions";
CREATE TRIGGER configuration_versions_proteger BEFORE UPDATE OR DELETE ON "configuration_versions" FOR EACH ROW EXECUTE FUNCTION configuration_versions_proteger();
DROP TRIGGER IF EXISTS configuration_versions_sans_vidage ON "configuration_versions";
CREATE TRIGGER configuration_versions_sans_vidage BEFORE TRUNCATE ON "configuration_versions" FOR EACH STATEMENT EXECUTE FUNCTION configuration_versions_proteger();

ALTER TABLE "prompts_ia" ADD COLUMN IF NOT EXISTS "motif" text;
ALTER TABLE "prompts_ia" ADD COLUMN IF NOT EXISTS "cree_par" text;
UPDATE "prompts_ia" SET "motif" = 'Historique (migrations 0018 et 0027)' WHERE "motif" IS NULL;

-- Seed v1 des valeurs du code : même contenu que PLANS, PRIX_PLANS, FRAIS_PAIEMENT, MOYENS_PAIEMENT (test d'égalité obligatoire).
-- Prix NON validé : la production reste verrouillée, comme avant la migration.
INSERT INTO "configuration_versions" ("id","categorie","cle","numero","valeurs","statut","effective_a","motif","cree_par") VALUES
 ('a5000000-plan-gratuit-1','plan','gratuit',1,'{"services":3,"realisations":3,"temoignages":3,"reservationsParMois":10,"generationsIaParMois":3,"badge":true,"statistiquesJours":7,"statistiquesDetails":false,"capacites":{"mcp":false}}','active','2000-01-01T00:00:00Z','Valeurs initiales reprises du code (0032)','systeme'),
 ('a5000000-plan-payant-1','plan','payant',1,'{"services":null,"realisations":null,"temoignages":null,"reservationsParMois":null,"generationsIaParMois":null,"badge":false,"statistiquesJours":90,"statistiquesDetails":true,"capacites":{"mcp":true}}','active','2000-01-01T00:00:00Z','Valeurs initiales reprises du code (0032)','systeme'),
 ('a5000000-prix-payant-1','prix','payant',1,'{"XAF":{"1":5000,"3":13500,"12":48000},"EUR":{"1":800,"3":2200,"12":7700},"USD":{"1":900,"3":2500,"12":8600}}','active','2000-01-01T00:00:00Z','Grille initiale, non validée (0032)','systeme'),
 ('a5000000-frais-kpay-1','frais','kpay:mobile_money',1,'{"tauxPointsBase":500,"supporteur":"marchand"}','active','2000-01-01T00:00:00Z','Frais initiaux reproduits du code (0032)','systeme'),
 ('a5000000-moyens-kpay-1','moyens','kpay',1,'{"actifs":["kpay:MTN_MOMO_CMR","kpay:ORANGE_CMR"]}','active','2000-01-01T00:00:00Z','Moyens actifs initiaux (0032)','systeme')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION prompts_ia_figer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'prompts_ia : suppression interdite' USING ERRCODE = '42501'; END IF;
  IF (NEW.type, NEW.version, NEW.systeme, NEW.gabarit, NEW.variables, NEW.parametres, NEW.schema_sortie, NEW.created_at)
     IS DISTINCT FROM (OLD.type, OLD.version, OLD.systeme, OLD.gabarit, OLD.variables, OLD.parametres, OLD.schema_sortie, OLD.created_at)
  THEN RAISE EXCEPTION 'prompts_ia : contenu figé' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prompts_ia_figer ON "prompts_ia";
CREATE TRIGGER prompts_ia_figer BEFORE UPDATE OR DELETE ON "prompts_ia" FOR EACH ROW EXECUTE FUNCTION prompts_ia_figer();

-- ROLLBACK manuel (au format de 0027, à exécuter dans l'ordre) :
-- DROP TRIGGER IF EXISTS prompts_ia_figer ON "prompts_ia"; DROP FUNCTION IF EXISTS prompts_ia_figer();
-- ALTER TABLE "prompts_ia" DROP COLUMN IF EXISTS "cree_par", DROP COLUMN IF EXISTS "motif";
-- DROP TRIGGER IF EXISTS configuration_versions_sans_vidage ON "configuration_versions";
-- DROP TRIGGER IF EXISTS configuration_versions_proteger ON "configuration_versions";
-- DROP FUNCTION IF EXISTS configuration_versions_proteger();
-- DROP TABLE IF EXISTS "configuration_versions"; DROP TABLE IF EXISTS "usernames_bloques";
-- DROP TABLE IF EXISTS "pays"; DROP TABLE IF EXISTS "devises";
-- Le code d'avant 0032 relit les constantes : les versions créées après la migration sont alors ignorées (à noter dans l'exploitation).
```

Côté Drizzle : `shared/db/schema.ts` reçoit `devises`, `pays`, `usernamesBloques`, `configurationVersions`, et les colonnes `motif`, `cree_par` de `promptsIa`. `pnpm db:generate` doit répondre « No schema changes » après la migration. Les séparateurs `--> statement-breakpoint` sont à ajouter comme dans 0028.

## 5. Backend

- `server/services/configuration/lecture.ts` : `lireVersionActive(categorie, cle, { sansCache })`, `lirePlanConfig(plan)` (synchrone, depuis un instantané rafraîchi toutes les 5 s, repli sur les constantes), `lireGrillePrix()`, `lireFrais(fournisseur, methode)`, `lireMoyensActifs()`.
- `server/services/configuration/versions.ts` : `creerBrouillon(auteur, adaptateur, entree)`, `programmerOuActiver(tx, auteur, id, { programmeePour, impactAcquitte, motif })`, `retourArriere(tx, auteur, id, { motif })`, `validerPrix(tx, auteur, id, { motif })`. Adaptateurs dans `server/services/configuration/adaptateurs/{plans,prix,frais,moyens,prompts}.ts`, chacun avec son schéma Zod strict (`shared/schemas/admin-versions.ts`) et `lireActive`. L'adaptateur `prompts` écrit dans `prompts_ia` (`actif`) et n'a pas de date d'effet (⚠️ activation immédiate seulement).
- `server/services/configuration/impact.ts` : `apercuImpactPlan(plan, valeursCandidates)`.
- `server/services/configuration/catalogues.ts` : `listerCatalogue(nom)`, `creerEntree`, `modifierEntree`, `supprimerEntree`, `verifierNomUtilisateur(valeur)` (`isReserved` du code ET `usernames_bloques`, appelé à la création de vitrine et au changement d'adresse), `pays Actif(code)`, `canalCodePourIndicatif(indicatif, canal)`.
- `server/services/ia/essai.ts` : `essaiPrompt(entree)` (fixtures synthétiques, limiteur Redis 10/h/admin, aucune écriture). `server/services/ia/prompts.ts` : `creerVersionPrompt`, `activerPrompt` (dans `prompts.ts` pour rester le seul lecteur).
- Modifications (fichier par fichier, après lecture, avec `regression-checker`) : `server/services/plans.ts` (`limiteDe` lit `lirePlanConfig`, `assertQuota` sans cache) ; `plan-visibilite.ts:41`, `statistiques.ts:195`, `seo-sitemap.ts:53`, `abonnements.ts:36,64` (`PLANS` → `lirePlanConfig`) ; `server/config/paiements.ts` (`paiementVerrouille(env, validee)`, `assertConfigPaiements` asynchrone, lit l'état « validé ») ; `server/plugins/config-paiements.ts` (asynchrone) ; `initiation.ts` (`prixAffiche` contrôlé, 409 `PRIX_CHANGE`) ; `offre.ts:50` ; `application.ts` (inchangé) ; `shared/schemas/abonnement.ts` (`prixAffiche: int` requis, `.strict()`) ; `auth.config.ts:205-217` (garde `CANAL_INDISPONIBLE` avant `enqueueOtpSms`) ; `server/services/otp/envoi.ts` (inchangé, sauf commentaire) ; `statistiques.ts:155,204` et `liens.ts:246` (fuseau de repli via `lirePaysFuseauRepli`).
- Routes admin (minces : `requireSuperadmin` en premier, validation Zod d'entrée, service, `resources/admin-catalogues.ts` ou `admin-versions.ts` avec sortie `.strict()` construite champ par champ) :
  - `GET /api/admin/catalogues/[nom]` (liste) ; `POST /api/admin/catalogues/[nom]` (noms-bloques seulement) ;
  - `GET|PATCH|DELETE /api/admin/catalogues/[nom]/[id]` (`nom` ∈ `pays`, `devises`, `noms-bloques`) ;
  - `GET /api/admin/versions/[type]?cle=` (historique) ; `POST /api/admin/versions/[type]` (brouillon) ;
  - `POST /api/admin/versions/[type]/[id]/activer` (réauth `version.activer`, corps `{ programmeePour: ISO|null, impactAcquitte?, motif }`) ;
  - `POST /api/admin/versions/[type]/[id]/retour` (réauth `version.retour`) ; `POST /api/admin/versions/prix/[id]/valider` (réauth `version.valider_prix`) ;
  - `POST /api/admin/versions/plans/impact` (lecture seule) ; `POST /api/admin/versions/prompts/essai` (lecture seule, sans persistance).
- Public : `server/api/referentiels.get.ts` (D-A5-15), réponse validée par un schéma strict.
- Job : `server/jobs/versions.ts` (`versions-appliquer`, file `maintenance`) ; enregistré dans `server/jobs/queues.ts`.
- `shared/admin.ts` : `ADMIN_ACTIONS` gagne `catalogue.creer`, `catalogue.modifier`, `catalogue.supprimer`, `version.creer`, `version.programmer`, `version.activer`, `version.retour`, `version.valider_prix`, `prompt.essai` (non journalisé) ; `ADMIN_NAV` gagne « Catalogues » et « Versions ». `shared/erreurs.ts` : `CATALOGUE_ENTREE_UTILISEE` (409), `PRIX_CHANGE` (409), `IMPACT_CHANGE` (409), `CANAL_INDISPONIBLE` (422), `VERSION_NON_ACTIVABLE` (422), `VARIABLE_INCONNUE` (422), `ESSAI_LIMITE` (429), `NOM_BLOQUE` (422), `FUSEAU_INCONNU` (422).
- Chaque écriture : `db.transaction` ; `exigerReauth` si action réauthentifiée ; `Audit.enregistrer(tx, { adminId, action, cibleType, cibleId, avant, apres, motif, ip, cleIdempotence })` dans la même transaction.

## 6. Aperçu d'impact (SQL, lecture seule)

Pour une limite candidate `$L` sur `services` (réalisations et témoignages : même requête, autre table). Le prédicat « publiée » est `sqlVitrinePublique()` (A2). Les comptes gratuits sont ceux sans abonnement dont la grâce est écoulée (`ABONNEMENT_GRACE_JOURS`, approximation en SQL à une journée près, à documenter).

```sql
WITH comptes_gratuits AS (
  SELECT u.id FROM users u LEFT JOIN abonnements a ON a.user_id = u.id
  WHERE a.user_id IS NULL OR a.expire_le + make_interval(days => $grace) <= now()
),
vitrines_visibles AS (
  SELECT v.id, v.user_id FROM vitrines v
  JOIN comptes_gratuits c ON c.id = v.user_id
  WHERE /* sqlVitrinePublique() : A2 */ true
),
comptage AS (
  SELECT vv.user_id, count(s.id) FILTER (WHERE s.actif) AS actifs
  FROM vitrines_visibles vv LEFT JOIN services s ON s.vitrine_id = vv.id
  GROUP BY vv.id, vv.user_id
)
SELECT count(DISTINCT user_id) FILTER (WHERE actifs > $L) AS comptes,
       coalesce(sum(greatest(actifs - $L, 0)), 0) AS elements_masques
FROM comptage;
```

Réservations et IA ne masquent rien : leur aperçu compte les comptes dont l'usage du mois courant atteint déjà `$L` (même principe, requête à écrire par le backend). Un changement sur le plan payant n'est aperçu que si sa limite devient finie.

## 7. Frontend (`app/**`, @nuxt/ui uniquement, couleurs par variables, Phosphor)

- `app/pages/admin/catalogues/index.vue` : trois onglets (Pays, Devises, Noms bloqués) ; `app/components/admin/CatalogueTableau.vue` (`UTable` + `USlideover` avec motif et `UForm`). Pays : libellé, indicatif, devise par défaut, fuseaux (champ multi-saisie validé), trois interrupteurs `USwitch` pour les canaux, interrupteur « actif ». Un pays utilisé affiche « Désactiver » et jamais « Supprimer ».
- `app/pages/admin/versions/index.vue` : sélecteur de type (Plans, Prix, Frais, Moyens, Prompts IA) ; `app/components/admin/VersionsHistorique.vue` (générique : liste, « Nouvelle version », « Activer », « Programmer », « Retour arrière », statut, motif). Spécifiques, branchés dans le mécanisme : `ApercuImpactPlan.vue` (tableau de comptes et d'éléments, bouton d'activation désactivé tant que l'aperçu n'est pas chargé) ; `EditeurPrompt.vue` (systeme, gabarit, parametres avec bornes, schéma en lecture seule, essai à blanc avec compteur).
- Réauthentification : `UPinInput` (composant d'A1) avant chaque action marquée. Chaque bouton a ses états (normal, survol, focus, désactivé, chargement, erreur).
- `app/pages/connexion/index.vue` : liste SMS et indicatifs lue sur `/api/referentiels` ; l'option WhatsApp reste désactivée tant que le fournisseur n'existe pas. Onboarding : liste des pays et devises lue sur `/api/referentiels` (pages à localiser).
- Vocabulaire : « vitrine », vouvoiement, aucune couleur en dur.

## 8. Critères de réception (Given / When / Then)

- **CA01** Given un pays `TD` utilisé par une vitrine, When l'admin tente de le supprimer, Then 409 `CATALOGUE_ENTREE_UTILISEE` ; When il le désactive, Then `TD` n'apparaît plus dans `/api/referentiels` ni dans les nouvelles sélections, et les profils existants restent valides.
- **CA02** Given `canal_sms` de `CM` désactivé, When un numéro `+237…` demande un code par SMS, Then 422 `CANAL_INDISPONIBLE` sans mise en file ; When le drapeau est réactivé, Then le code part, sans redéploiement.
- **CA03** Given les services gratuits à 3 et 5 services publiés chez 2 comptes gratuits, When l'admin prévisualise la limite 3, Then l'aperçu indique `comptes=1`, `elements_masques=2` ; After activation, Then les 2 services en trop sont masqués publiquement, jamais supprimés ; After retour arrière, Then ils réapparaissent.
- **CA04** Given une baisse de limite, When l'activation est envoyée avec un `impactAcquitte` périmé, Then 409 `IMPACT_CHANGE`.
- **CA05** Given un paiement initié au prix P1, When une grille P2 est activée et validée, Then le paiement garde P1 et le webhook est vérifié contre lui.
- **CA06** Given la grille P2 active, When un client envoie `prixAffiche` = P1, Then 409 `PRIX_CHANGE` avec le montant P2 et aucun paiement créé.
- **CA07** Given la grille seedée non validée, When un paiement est initié en production, Then 503 `PAIEMENT_INDISPONIBLE` (comportement actuel conservé).
- **CA08** Given un prompt v2 actif, When l'admin édite le gabarit, Then une version v3 `actif=false` est créée et v2 reste inchangée ; une tentative de modifier v2 en SQL échoue (42501).
- **CA09** Given un gabarit contenant `{{nom}}`, When il est enregistré, Then 422 `VARIABLE_INCONNUE`.
- **CA10** Given un essai à blanc, When la requête contient une donnée utilisateur, Then elle est refusée par le schéma strict ; When 11 essais sont faits en une heure, Then 429 `ESSAI_LIMITE`.
- **CA11** Given une version active et une version précédente, When le retour arrière est demandé sans réauthentification, Then `REAUTH_REQUISE` ; With réauthentification, Then la précédente devient `active` et l'actuelle `remplacee`.
- **CA12** Given une version programmée pour T, When T est dépassé de moins de 60 s, Then elle est active (job `versions-appliquer`).
- **CA13** Given une écriture dont le journal échoue, Then rien ne change (version, statut, drapeau).
- **CA14** Given `UPDATE configuration_versions SET valeurs = …`, `DELETE` ou `TRUNCATE`, Then erreur 42501.
- **CA15** Given une clé d'idempotence rejouée, Then la réponse est identique et aucune ligne n'est ajoutée.
- **CA16** Given un nom réservé ou bloqué, When une vitrine le prend ou un utilisateur le choisit comme adresse, Then refus `NOM_BLOQUE` ; les vitrines existantes ne sont pas modifiées.
- **CA17** Given toute route `/api/admin/catalogues|versions/**`, Then les réponses sont listes blanches (test d'énumération A1 : nouvelles routes déclarées dans `CONTRAT`).

## 9. Tests (base PostgreSQL réelle pour tout ce qui écrit ; aucun mock du journal, des triggers, des verrous)

- `tests/integration/admin/catalogues.test.ts` (CA01, CA16, CA17) ; `versions-plans.test.ts` (CA03 à CA05, CA11, CA12, CA13) ; `versions-prix.test.ts` (CA06, CA07) ; `versions-prompts.test.ts` (CA08 à CA10) ; `versions-triggers.test.ts` (CA14, CA15) ; `tests/integration/configuration/seed-v1.test.ts` : les valeurs seedées sont égales à `PLANS`, `PRIX_PLANS`, `FRAIS_PAIEMENT`, `MOYENS_PAIEMENT` (actifs).
- Non-régression obligatoire (`regression-checker`) : `PlanService` (résolution, quotas sous verrou, `getQuotas`), masquage public (`plan-visibilite`), statistiques, sitemap, `/tarifs`, initiation et webhook de paiement (tests existants), onboarding (pays), envoi de codes (e-mail, SMS, boîte de développement), MCP (`mcp` capacité).
- Unitaires : `tests/unit/configuration/lecture.test.ts` (cache 5 s, repli sur le code), `impact.test.ts`, `validations.test.ts` (bornes, cross-validation, fuseaux `Intl`).
- E2E : `e2e/admin-catalogues.spec.ts`, `e2e/admin-versions.spec.ts` (réauthentification, aperçu, activation). Vérifier que les fichiers sont dans le workflow CI (non vérifié ici).

## 10. Périmètres de fichiers (disjoints)

**Thread principal, AVANT les agents** : `shared/admin.ts` (ADMIN_ACTIONS, ADMIN_NAV), `shared/erreurs.ts`, `shared/schemas/admin-catalogues.ts`, `shared/schemas/admin-versions.ts`, `shared/schemas/abonnement.ts` (`prixAffiche`), `shared/fuseau.ts` (ajout `listerFuseaux()` si absent).

- **database** : `server/db/migrations/0032_a5_catalogues_versions.sql`, `server/db/migrations/meta/0032_snapshot.json`, `meta/_journal.json`, `shared/db/schema.ts`. Rien d'autre.
- **backend** : `server/services/configuration/**`, `server/services/ia/essai.ts`, `server/services/ia/essai-fixtures.ts`, `server/services/ia/prompts.ts`, `server/services/plans.ts`, `plan-visibilite.ts`, `statistiques.ts`, `liens.ts`, `seo-sitemap.ts`, `abonnements.ts`, `server/services/paiements/initiation.ts`, `offre.ts`, `server/config/paiements.ts`, `server/plugins/config-paiements.ts`, `server/auth.config.ts`, `server/api/admin/catalogues/**`, `server/api/admin/versions/**`, `server/api/referentiels.get.ts`, `server/resources/admin-catalogues.ts`, `server/resources/admin-versions.ts`, `server/jobs/versions.ts`, `server/jobs/queues.ts`. `server/config/plans.ts` : valeurs inchangées, commentaire « repli ». Pas de `PRIX_STATUT` supprimé avant que le database ait livré la migration.
- **frontend** : `app/pages/admin/catalogues/**`, `app/pages/admin/versions/**`, `app/components/admin/{CatalogueTableau,VersionsHistorique,ApercuImpactPlan,EditeurPrompt}.vue`, `app/pages/connexion/index.vue` (liste de canaux uniquement), pages onboarding (liste des pays). Rien dans `server/`.
- **tester** : `tests/**`, `e2e/admin-catalogues.spec.ts`, `e2e/admin-versions.spec.ts`, `playwright.config.ts` (si besoin).
- Aucun agent ne touche aux fichiers des autres. Le reviewer (opus, sécurité) relit le diff ; `regression-checker` couvre le reste du dépôt.

## 11. Risques et questions ouvertes

- **⚠️ R1 (bloquant avant production)** : montant du webhook K-PAY brut ou net (décision #13, A3). La vérification `application.ts:88` suppose le brut. Une version de prix n'y change rien, mais une erreur ici rend chaque paiement `anomalie`.
- **⚠️ R2** Pays créés uniquement par migration (D-A5-10). Alternative : création depuis l'interface avec indicatif, fuseaux et format de numéro obligatoires. Défaut : migration.
- **⚠️ R3** Devises XOF (CI, SN, BJ, TG, BF, ML, NE, CEMAC non XAF) : `devise_defaut` provisoire à `XAF`. La devise XOF n'est pas gérée par le code (`DEVISES` ne la contient pas). Décision produit à prendre avant de publier la liste.
- **⚠️ R4** Canal e-mail sans effet sur la connexion (D-A5-13). Alternative : bloquer la connexion par e-mail pour les pays désactivés (non recommandé : la connexion ne connaît pas le pays).
- **⚠️ R5** `canal_sms` : SMS non branché en production aujourd'hui ; le drapeau ne protège rien tant qu'il n'y a pas de fournisseur. Décision : le fournisseur SMS passe avant toute promesse de canal par pays.
- **R6** Date d'effet : délai de 60 s (job). Une baisse de limite est visible au public 10 s après activation (cache public d'A2), plus 5 s (cache de lecture) : total ≤ 15 s.
- **R7** Impact approximatif sur la grâce (une journée) ; le backend le documente dans l'aperçu.
- **R8** `+1` partagé par le Canada et les États-Unis (D-A5-13) : le plus restrictif s'applique.
- **R9** `PRIX_STATUT` supprimé : son remplacement (`validee_le`) change le démarrage (asynchrone). Un échec de lecture au démarrage en production laisse les paiements verrouillés, sans bloquer le serveur (⚠️ à confirmer).
- **R10** La v1 seedée et les constantes du code doivent rester identiques tant que le repli existe : le test `seed-v1` le garantit ; une modification future de la grille passe par une nouvelle version, jamais par une édition du code seul.
- **R11** Non vérifié : `isReserved` est-il appelé à la création et au changement d'adresse ? Non inventorié ici : le backend le vérifie avant d'écrire.
- **R12** Non vérifié : `dto/abonnement.ts` (`PrixPeriodeDTO`) doit exposer le montant TTC affiché (incluant les frais) pour que `prixAffiche` soit exactement celui vu par le client.
