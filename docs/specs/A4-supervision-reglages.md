# Spec A4 — Supervision et registre des réglages (tier critique)

Source : `docs/specs/sprints-admin-A1-A5.md`, `A1-socle-admin.md`, `A2`, `A3`. Migration `0031_a4_supervision_reglages` (A5 prendra 0032).

## 0. CHALLENGE

- **Angles morts** : (a) Bull Board expose des mutations (relance, nettoyage) hors journal et hors réauthentification ; (b) un repli « configuration du code » peut **ouvrir** une fonction (inscriptions, MCP) ; (c) `PAIEMENT_EN_LIGNE` est lu aussi par le front : le basculer à chaud expose un paiement sans clés K-PAY ; (d) le journal A1 n'accepte que des valeurs ≤ 64 caractères ; (e) les défauts d'agenda sont des colonnes **par vitrine** ; (f) `generations_ia` est purgée à 30 jours ; (g) le quota gratuit IA vit dans les plans (A5).
- **Meilleure approche** : API BullMQ native (pas de dépendance, toute action passe par nos routes) ; registre **restreint** aux réglages d'exploitation (les limites anti-abus restent dans le code) ; repli **par clé**, restrictif pour les drapeaux de sécurité ; compteur d'échecs en Redis, indépendant de `removeOnFail`.
- **À retirer** : pages par réglage ; relance d'un OTP échoué ; rétentions outbox, vues et statistiques (décision juridique).
- **Périmètre réel** : `server/auth.config.ts` (S1), `server/services/ia/*` (S8), `worker/index.ts` (toutes les files), `server/services/plans.ts` et `server/middleware/mcp-*` (S16), `server/services/services.ts` (S10, lecture seule), `onboarding.ts` (création de vitrine), purges, gabarits de grâce. Régression obligatoire.

## 1. Décisions (défaut appliqué ; ⚠️ = votre arbitrage)

- **D-A4-01 ⚠️** Pas de Bull Board ni de nouvelle dépendance. `server/services/admin/supervision-files.ts` utilise `Queue.getJobCounts`, `getFailed`, `job.retry`. Bull Board 9.13.1 (`@bull-board/h3`) est absent de `node_modules` ; s'il est voulu, le monter en lecture seule derrière `requireSuperadmin`.
- **D-A4-02** Relance uniquement d'un job `failed`, refusée pour `messages-auth` (`JOB_NON_RELANCABLE`). Purge : `failed` seulement, 1 000 au plus, journalisée.
- **D-A4-03** Alerte : le worker incrémente `supervision:echecs:{file}:{tranche5min}` (INCR, EXPIRE 1 h, fail-open) à chaque échec **définitif**. Un job répété toutes les 5 min somme 3 tranches ; seuil `supervision.seuil_echecs_15_min` (20) ; une alerte par heure (clé `supervision:alerte`).
- **D-A4-04** Registre pur dans `shared/reglages.ts` (aucune valeur d'environnement). Repli dans `server/config/reglages-code.ts`, seul lecteur de `env` pour les réglages. Secrets jamais dans le registre (garde de test sur les noms : `secret|key|token|password|url|cle`).
- **D-A4-05** `Reglages.lire(cle)` : cache 5 s par processus, timeout de lecture 300 ms, échec mémorisé 5 s. Valeur en base invalide : repli code + log sans la valeur.
- **D-A4-06 ⚠️** Repli **par clé** : `mcp.actif`, `inscriptions.ouvertes`, `ia.active`, `paiement.en_ligne` se replient sur la valeur **restrictive** (fermé / coupé). Les autres sur la valeur du code.
- **D-A4-07 ⚠️** `paiement.en_ligne` en **lecture seule** (`modifiable: false`). `PAIEMENT_EN_LIGNE`, `MCP_ACTIF` et `SEO_IA_REGENERATION_ACTIVE` restent les défauts dans `shared/env.ts`.
- **D-A4-08 ⚠️** Maintenance : 503 `MAINTENANCE` (`Retry-After: 300`) sur `/api/studio/**` (hors GET) et sur `/api/auth/{sign-in,email-otp,phone-number}/**`. Le studio affiche `PageMaintenance` d'après `GET /api/public/etat`. Vitrines publiques et admin ouverts. Message : texte brut, 280 caractères au plus.
- **D-A4-09 ⚠️** Inscriptions fermées : `user.create.before` refuse la création de compte sur l'hôte public (couvre e-mail et téléphone, à vérifier dans Better Auth 1.7.18) ; aucun envoi de code à une adresse inconnue (réponse identique). Comptes existants inchangés.
- **D-A4-10** `ia.active=false` : repli déterministe sans appel fournisseur, motif `ia_coupee` (ajouté à `MOTIFS_REPLI` et au CHECK en 0031).
- **D-A4-11 ⚠️** MCP : `mcp.actif` reste la coupure **globale** (enregistrement dynamique et endpoint). La capacité `mcp` par compte est lue par `PlanService` après connexion (consentement et chaque appel d'outil). Alternative plus stricte : fermer l'enregistrement et créer les clients pilotes depuis l'admin.
- **D-A4-12 ⚠️** Quota gratuit IA et valeurs de plans : **A5**. A4 affiche seulement la valeur.
- **D-A4-13 ⚠️** Rétentions pilotables : IA 30 j, inscriptions abandonnées 90 j, indisponibilités 90 j, OAuth orphelins 7 j, grâce 7 j. Restent en code : outbox, vues, statistiques, désabonnement.
- **D-A4-14** Défauts d'agenda (préavis 2 h, horizon 60 j) : s'appliquent aux **nouvelles** vitrines seulement.
- **D-A4-15** Envois : table sans identifiant ni code. Instrumentation dans le worker, autour de `processOtpJob`, en `try/catch` **sans rethrow** (sinon BullMQ renverrait un code). Pays via `libphonenumber-js` (à ajouter à `docs/bibliotheques.md`) ; e-mail : pays `NULL`. Purge à 90 j.
- **D-A4-16 ⚠️** Sauvegarde : `battements_systeme` (`sauvegarde_derniere_reussite`), écrite par `scripts/sauvegarde-battement.ts` appelé après un `pg_dump` réussi. **Sans ce script, l'indicateur reste « inconnu »** (il n'est pas retiré). Alerte au-delà de 26 h.
- **D-A4-17** IA : agrégats sur 30 jours au plus ; top consommateurs = identifiant tronqué + lien vers la fiche A2 ; `entree` et `sortie` jamais lus.
- **D-A4-18** `GET journal` et `GET journal/verifier` non journalisés (verifier limité à 5/min) ; `POST journal/export` avec motif, journalisé.
- **D-A4-19** Réauthentification pour toute écriture de réglage, sauf `maintenance.message` et les défauts d'agenda. Chaque écriture porte `cleIdempotence` (index unique d'A1).
- **D-A4-20** Journal : un texte est journalisé `{ longueur: n }` ; un nombre ou un booléen en clair.
- **D-A4-21 ⚠️** Limites pilotables : seulement `ia.limite_utilisateur_heure`, `ia.plafond_global_jour`, `seo.limite_vitrine_jour`. Les autres `RateLimit` restent dans `shared/limites.ts`.
- **D-A4-22** `APP_VERSION` optionnelle dans `shared/env.ts` (défaut `inconnue`).

## 2. Registre (`shared/reglages.ts`)

Entrée : `cle`, `type` (`entier`|`booleen`|`texte`), `libelle`, `aide`, bornes, `categorie`, `reauth`, `modifiable`, `valider?`.

| Clé | Défaut (bornes) | Réauth | Validation croisée |
|---|---|---|---|
| `ia.limite_utilisateur_heure` | 10 (1–100) | oui | — |
| `ia.plafond_global_jour` | 2000 (10–100 000) | oui | — |
| `seo.limite_vitrine_jour` | 5 (0–20) | oui | ≤ `ia.plafond_global_jour` |
| `ia.active` | vrai (repli faux) | oui | — |
| `seo.regeneration_active` | vrai | oui | — |
| `inscriptions.ouvertes` | vrai (repli faux) | oui | — |
| `maintenance.active` | faux | oui | si vrai, message non vide |
| `maintenance.message` | texte ≤ 280 | non | — |
| `mcp.actif` | faux (repli faux) | oui | — |
| `paiement.en_ligne` | faux | **lecture seule** | — |
| `abonnement.grace_jours` | 7 (0–30) | oui | — |
| `retention.ia_jours` | 30 (7–365) | oui | — |
| `retention.inscriptions_abandonnees_jours` | 90 (7–365) | oui | — |
| `retention.indisponibilites_jours` | 90 (30–365) | oui | — |
| `retention.oauth_orphelins_jours` | 7 (1–90) | oui | — |
| `agenda.preavis_defaut_heures` | 2 (0–720) | non | — |
| `agenda.horizon_defaut_jours` | 60 (1–365) | non | — |
| `supervision.seuil_echecs_15_min` | 20 (1–10 000) | non | — |
| `supervision.disque_alerte_pct` | 15 (5–50) | non | — |

## 3. Migration `0031_a4_supervision_reglages.sql`

```sql
CREATE TABLE IF NOT EXISTS "reglages" (
  "cle" text PRIMARY KEY CHECK ("cle" ~ '^[a-z][a-z0-9_.]{2,63}$'),
  "valeur" jsonb NOT NULL CHECK (jsonb_typeof("valeur") IN ('number','boolean','string')),
  "modifie_par" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "modifie_le" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "capacites_accordees" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capacite" text NOT NULL CHECK ("capacite" IN ('mcp')),
  "motif" text NOT NULL CHECK (char_length(btrim("motif")) BETWEEN 5 AND 500),
  "accorde_par" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "accorde_le" timestamp with time zone NOT NULL DEFAULT now(),
  "revoque_le" timestamp with time zone,
  CHECK ("revoque_le" IS NULL OR "revoque_le" >= "accorde_le")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capacites_accordees_actives_unique"
  ON "capacites_accordees" ("user_id","capacite") WHERE "revoque_le" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "envois_codes" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "cree_le" timestamp with time zone NOT NULL DEFAULT now(),
  "canal" text NOT NULL CHECK ("canal" IN ('sms','email','whatsapp')),
  "pays" text CHECK ("pays" IS NULL OR "pays" ~ '^[A-Z]{2}$'),
  "statut" text NOT NULL CHECK ("statut" IN ('envoye','echec')),
  "tentative" smallint NOT NULL CHECK ("tentative" BETWEEN 1 AND 3),
  "code_erreur" text CHECK ("code_erreur" IS NULL OR char_length("code_erreur") <= 40)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "envois_codes_cree_le_idx" ON "envois_codes" ("cree_le","canal","pays");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "battements_systeme" (
  "cle" text PRIMARY KEY CHECK ("cle" ~ '^[a-z_]{3,40}$'),
  "horodatage" timestamp with time zone NOT NULL,
  "ecrit_le" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'generations_ia'::regclass
    AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%motif_repli%' LOOP
    EXECUTE format('ALTER TABLE "generations_ia" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "generations_ia" ADD CONSTRAINT "generations_ia_motif_repli_check"
  CHECK ("motif_repli" IS NULL OR "motif_repli" IN ('echec_fournisseur','delai_depasse','sortie_invalide','injection',
    'sans_fournisseur','sans_prompt','file_indisponible','limiteur_indisponible','plafond_global','quota_atteint','ia_coupee')) NOT VALID;--> statement-breakpoint
ALTER TABLE "generations_ia" VALIDATE CONSTRAINT "generations_ia_motif_repli_check";
-- ROLLBACK manuel (non automatique) : DROP TABLE IF EXISTS "battements_systeme", "envois_codes",
-- "capacites_accordees", "reglages"; supprimer 'ia_coupee' (aucune ligne ne doit l'avoir) puis
-- recréer le CHECK de 0027.
```

Drizzle : tables `reglages`, `capacitesAccordees`, `envoisCodes`, `battementsSysteme` ; `ia_coupee` ajouté à `MOTIFS_REPLI`. Un second `pnpm db:generate` répond « No schema changes ». Actions du journal ajoutées : `reglage.modifier`, `job.relancer`, `job.purger`, `journal.exporter`, `capacite.accorder`, `capacite.revoquer`.

## 4. Backend

**Services** (signatures) :
- `server/services/reglages.ts` : `Reglages.lire<K>(cle, executeur?)`, `lireTout()`, `ecrire(tx, { cle, valeur | null, adminId, motif, cleIdempotence, ip })` (verrou `FOR UPDATE`, `null` = défaut, journal dans la transaction), `_viderCache()`. Cache `Map` par processus.
- `server/services/admin/reglages.ts` : `modifierReglage()` (réauthentification puis `ecrire`).
- `server/services/admin/supervision-files.ts` : `lireEtatFiles()` (compteurs, 20 échecs au plus par file, `failedReason` réduit à un code allowlisté, **jamais `job.data`**), `relancerJob(tx, …)` (journal puis `job.retry` après commit), `purgerEchecs(tx, …)`.
- `server/services/admin/supervision-alertes.ts` : `alerterSiSeuil(now)`.
- `server/services/admin/agregats-ia.ts`, `agregats-pwa.ts`, `sante.ts`, `assistants.ts` : SQL à colonnes explicites. Santé : `SELECT 1` (timeout 2 s), `redis.ping()`, `fs.statfs(env.MEDIAS_DIR)`, battement, `APP_VERSION`. Assistants : `journal_assistant` agrégé, sans `arguments_resume`, `resultat`, `avant`, `apres`.
- `server/services/admin/journal.ts` : `listerJournal`, `exporterJournalCsv(filtres, motif, …)`, `verifierChaineAdmin()` (A1).
- `server/services/csv.ts` : `cellulesCsv()` préfixe `'` aux cellules commençant par `= + - @` ou tabulation/retour.
- `server/services/envois-codes.ts` : `enregistrerEnvoi(...)` (ne lève jamais), `agregerEnvois`, `purgerEnvois`.
- `server/services/supervision-echecs.ts` : `enregistrerEchecFile(file, now)`.
- `server/config/reglages-code.ts` : `valeurDuCode(cle)`.

**Routes** (`defineApiHandler`, `requireSuperadmin` d'abord, sortie `.strict().parse`) :

| Route | Entrée | Réauth | Journal |
|---|---|---|---|
| `GET /api/admin/reglages` | — | non | non |
| `PUT /api/admin/reglages/[cle]` | `{ valeur \| null, motif, cleIdempotence }` | oui (D-A4-19) | `reglage.modifier` |
| `GET /api/admin/systemes/jobs` | — | non | non |
| `POST /api/admin/systemes/jobs/relancer` | `{ file, id, motif, cleIdempotence }` | non | `job.relancer` |
| `POST /api/admin/systemes/jobs/purger` | `{ file, motif, limite ≤ 1000 }` | oui | `job.purger` |
| `GET /api/admin/systemes/{envois,ia,pwa,sante,assistants}` | `jours` si besoin | non | non |
| `POST /api/admin/utilisateurs/[id]/capacites` (A2) | `{ capacite: 'mcp', motif }` | oui | `capacite.accorder` |
| `DELETE /api/admin/utilisateurs/[id]/capacites/[capacite]` (A2) | `{ motif }` | non | `capacite.revoquer` |
| `GET /api/admin/journal`, `GET …/journal/verifier` | filtres (`limite ≤ 100`) | non | non |
| `POST /api/admin/journal/export` | `{ filtres, motif }` | non | `journal.exporter` |
| `GET /api/public/etat` (public) | — | — | — |

Schémas stricts (`shared/schemas/admin-a4.ts`) : aucun n'inclut `email`, `telephone`, `entree`, `sortie`, `contenu` ni `job.data`.

**Intégrations** : `server/middleware/maintenance.ts` (après `00-hote.ts`) ; `server/auth.config.ts` (`user.create.before`, filtre des envois) ; `mcp-inactif.ts`, `mcp/http.ts:53`, `mcp/decouverte.ts:17`, `services/assistants.ts:96` (lecture de `mcp.actif`) ; `services/plans.ts` (`aCapaciteMcp`) branché sur `mcp-plan-consentement.ts` et les outils ; `ia/generations.ts` (177, 179, 499) et `ia/seo.ts` (90, 95), `jobs/seo.ts:36` ; `onboarding.ts:683` et la création de vitrine (insertion à localiser) ; `indisponibilites-purge.ts:16` ; `oauth-purge.ts:34,93` ; `plans.ts:93`, `resources/abonnement.ts:77`, `emails/notifications-contenus.ts:447` (grâce) ; `worker/index.ts` (listener `failed`, jobs `controlerEchecsFiles` et `purgerEnvois` dans `maintenance`, enveloppe de `processOtpJob`) ; `scripts/sauvegarde-battement.ts`.

**Erreurs** (`shared/erreurs.ts`) : `MAINTENANCE` 503, `INSCRIPTIONS_FERMEES` 403 (neutre), `REGLAGE_INCONNUE` 404, `REGLAGE_INVALIDE` 422 (sans valeur répétée), `REGLAGE_LECTURE_SEULE` 422, `JOB_NON_RELANCABLE` 422.

## 5. Frontend (`app/**`, @nuxt/ui)

- `app/pages/admin/reglages.vue` : **une seule page**, `USelect` de catégories, `AdminReglageLigne.vue` (`USwitch`, `UInput type=number` avec bornes, `UTextarea` avec compteur, badge « Lecture seule », « Rétablir le défaut »). Enregistrer : confirmation avec motif et code (`UPinInput`) si `reauth`.
- `app/pages/admin/systemes/{index,jobs,envois,ia,assistants}.vue` : santé en `UCard`, sous-navigation `UNavigationMenu`, `UTable` par file avec « Relancer » et « Purger » (désactivés pour `messages-auth`, avec explication).
- `app/pages/admin/journal.vue` : `UTable`, filtres, `USlideover` de détail, « Vérifier la chaîne », « Exporter » (motif).
- `app/pages/admin/index.vue` : carte `AdminCartePwa.vue` (30 jours) et `UBanner` pour échecs ou sauvegarde inconnue/ancienne.
- Studio : `PageMaintenance.vue` remplace le contenu si `etat.maintenance` ; un seul message à l'écran.
- Vouvoiement, « vitrine », icônes `i-ph-*`, couleurs par variables CSS.

## 6. Critères d'acceptation

- **CA01** Given un superadmin, When `ia.limite_utilisateur_heure` = 0, Then 422, aucune ligne en base, aucun journal.
- **CA02** Given `maintenance.active`, When un visiteur appelle `PUT /api/studio/…` ou `POST /api/auth/sign-in/…`, Then 503 `MAINTENANCE` ; `GET /api/public/[username]` reste 200 ; `/api/admin/session` reste 200.
- **CA03** Given la maintenance désactivée, Then le studio est rétabli sans redémarrage.
- **CA04** Given une valeur écrite par l'API, When lue dans l'API **et** dans le worker, Then la nouvelle valeur est vue en moins de 10 s.
- **CA05** Given une lecture de la table qui lève, When `lire('mcp.actif')`, Then `false` ; When `lire('ia.limite_utilisateur_heure')`, Then 10 ; aucune exception.
- **CA06** Given une clé de secret (`KPAY_SECRET_KEY`) ou inconnue, When `PUT`, Then 404 ou 422 ; le registre ne contient aucune clé de secret.
- **CA07** Given `ia.active=false`, When une génération est demandée, Then `repli`, motif `ia_coupee`, zéro appel fournisseur.
- **CA08** Given `inscriptions.ouvertes=false`, When une adresse inconnue demande un code, Then aucun compte, aucun job ; un compte existant se connecte.
- **CA09** Given un job `send-otp-email` en échec définitif, When relancé depuis l'interface, Then il repasse en attente, sans données affichées, et `job.relancer` est journalisé.
- **CA10** Given un job `messages-auth` en échec, When relance demandée, Then 422 `JOB_NON_RELANCABLE`.
- **CA11** Given 20 échecs définitifs en 15 min, When le contrôle tourne, Then une alerte est enfilée ; un second contrôle dans l'heure n'en envoie pas.
- **CA12** Given un OTP e-mail réussi et un SMS en échec, Then deux lignes `envois_codes` (pays nul pour l'e-mail, indicatif pour le SMS) ; aucune colonne ne contient numéro ni code ; une erreur d'insertion ne relance pas le job (un seul e-mail).
- **CA13** Given un export sans motif, Then 422 ; avec motif, `=cmd` devient `'=cmd` et `journal.exporter` est écrit.
- **CA14** Given une ligne altérée, When `journal/verifier`, Then `{ intacte: false, premiereRupture }`.
- **CA15** Given `mcp.actif=true` et un compte sans capacité, Then consentement et outils refusés ; capacité accordée puis révoquée : accès, puis refus en moins de 10 s.
- **CA16** Given des générations avec `entree` renseignée, Then aucune chaîne de contenu dans la réponse IA.
- **CA17** Given un message de maintenance de 200 caractères, Then le journal contient `{ "longueur": 200 }`.
- **CA18** Given un `PUT` rejoué avec la même `cleIdempotence`, Then la réponse est identique et la valeur n'est écrite qu'une fois.
- **CA19** Given `agenda.preavis_defaut_heures` = 4, When une nouvelle vitrine est créée, Then `preavis_heures = 4` ; les vitrines existantes ne changent pas.
- **CA20** Given `paiement.en_ligne`, When `PUT`, Then 422 `REGLAGE_LECTURE_SEULE`.
- **CA21** Given aucune sauvegarde enregistrée, Then `inconnu` ; Given une sauvegarde à 27 h, Then alerte.

## 7. Tests (base réelle, Redis de test ; aucun mock du journal, des droits, des déclencheurs ni de la file)

- Unitaires : `tests/unit/admin/reglages-registre.test.ts` (bornes, croisées, garde anti-secret), `maintenance.test.ts`, `csv.test.ts`, `contrat-confidentialite.test.ts` (nouvelles routes déclarées).
- Intégration : `tests/integration/admin/reglages.test.ts` (CA01, CA04, CA05, CA17–CA20), `supervision-jobs.test.ts` (CA09–CA11), `envois.test.ts` (CA12, non-régression S1/S9), `agregats.test.ts` (CA16, CA21), `inscriptions.test.ts` (CA08), `ia-coupee.test.ts` (CA07), `journal-supervision.test.ts` (CA13, CA14), `tests/integration/mcp-capacites.test.ts` (CA15).
- E2E : `e2e/admin-reglages.spec.ts` (CA02 sur deux hôtes, CA03), `e2e/admin-systemes.spec.ts`.
- CI : vérifier que chaque fichier est lancé dans `.github/workflows/ci.yml` ; un test `skipped` bloque le gate.

## 8. Périmètres de fichiers

**Thread principal, AVANT les agents** : `shared/reglages.ts`, `shared/schemas/admin-a4.ts`, `shared/admin.ts` (actions, constantes de supervision), `shared/erreurs.ts`, `shared/jobs.ts`, `shared/ia.ts` (`ia_coupee`), `shared/env.ts` (`APP_VERSION`).

1. **database** : `shared/db/schema.ts`, `server/db/migrations/0031_a4_supervision_reglages.sql`, `meta/0031_snapshot.json`, `meta/_journal.json`. Rien d'autre.
2. **backend** (après database) : `server/**` hors migrations, `worker/**`, `scripts/sauvegarde-battement.ts`, `package.json` et lockfile (`libphonenumber-js`), `docs/bibliotheques.md`. Pas de `app/**`, `tests/**`.
3. **frontend** (en parallèle du backend, sur les DTO partagés) : `app/**` uniquement.
4. **tester** (après backend et frontend) : `tests/**`, `e2e/**`. Aucun code de production.
5. **regression-checker** (après backend) : S1, S8, S9, S10, S16. Obligatoire.
6. **reviewer** (opus, critique) puis **ux-reviewer** sur `app/**`.

## 9. Risques et questions ouvertes

- **R1** D-A4-06 contredit le brief (« repli = configuration du code ») sur les drapeaux de sécurité. ⚠️
- **R2** `Reglages.lire` est sur le chemin public : cache 5 s, timeout 300 ms, échec mémorisé ; mesurer en charge.
- **R3** A2, A3 et A4 modifient `shared/schemas/admin.ts` et `app/pages/admin/index.vue` : enchaînement, pas de parallèle.
- **R4** `processOtpJob` touche la connexion (S1) : toute erreur d'instrumentation est avalée sans donnée (CA12).
- **R5** `libphonenumber-js` alourdit le worker ; alternative : table d'indicatifs maintenue, plus fragile.
- **Questions** : D-A4-01 (API native ou Bull Board), D-A4-07, D-A4-08 et D-A4-09 (la maintenance et les inscriptions bloquent-elles la connexion ?), D-A4-11 (MCP : coupure globale seule ou pilotes créés par l'admin), D-A4-12, D-A4-13 (rétentions à valider juridiquement), D-A4-16 (qui écrit le script de sauvegarde), D-A4-21.
