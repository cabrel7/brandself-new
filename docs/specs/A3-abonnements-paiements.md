# Spec A3 — Abonnements, paiements et revenus (tier critique)

Source : brief `docs/specs/sprints-admin-A1-A5.md` (A3 + COMPLÉMENT ADMIN) et `docs/specs/A1-socle-admin.md`. Migration : `0030_a3_paiements_admin`. Pré-requis : A1 (`requireSuperadmin`, `Audit.enregistrer`, `exigerReauth`), S10. A2 est livré avant A3 (voir risque R6).

## 1. CHALLENGE

**Hypothèses implicites du brief**
- Le `amount` du webhook K-PAY est le montant brut. Ce n'est pas confirmé (décision #13 de S10 ouverte). Le code actuel le suppose (`application.ts:88`).
- « Marquer comme payé » suppose qu'on corrige un paiement existant. En réalité, un marquage manuel crée un encaissement. Il peut doubler un paiement que K-PAY encaisse plus tard.
- A2 « offrir des jours » crée un abonnement `offert`, alors que cette spec plaçait la colonne `abonnements.origine` en A3. **Tranché : A2 (migration 0029) livre la colonne avec les valeurs `paiement|offert|admin` ; A3 ne la recrée pas.** A3 doit donc passer APRÈS A2 (ordre normal des sprints).
- Le rappel « envoyer maintenant » n'est pas un simple bouton : le planificateur ne crée que des occurrences `J{n}:…` (`services/notifications/pertinence.ts`), et une occurrence inconnue annule le rappel.

**Angles morts**
- Un paiement `anomalie` est un état FINAL (`transitions.ts:28`). Si K-PAY envoie le net, chaque succès devient `anomalie` et ne peut plus être corrigé.
- Un encaissement K-PAY tardif (`expire` puis `completed`) est appliqué (`transitions.ts:9`). Après un marquage manuel, il prolongerait l'abonnement une seconde fois.
- Un compteur de webhooks refusés à une ligne par requête grossit sans limite sous attaque.
- L'export CSV sort des données personnelles : il doit être journalisé.

**Meilleure approche (ce que j'ai appliqué)**
1. Un seul service de confirmation, `confirmerPaiement`, appelé par le webhook, la revérification et le marquage manuel.
2. Le marquage manuel crée un NOUVEAU paiement `source='manuel'`. Il n'est permis que si K-PAY confirme ne pas avoir encaissé. Le paiement d'origine passe alors à `anomalie` (final), ce qui bloque un encaissement tardif.
3. Compteur des webhooks refusés agrégé par heure (une ligne par heure, fournisseur et motif) : taille bornée.
4. Export en `POST` : le motif ne figure pas dans l'URL des journaux d'accès.
5. Revenus par devise, en montants bruts appliqués. Aucun net inventé.

**À retirer ou simplifier**
- Taux de renouvellement : reporté (A4).
- Reçu par e-mail pour un paiement manuel : non (D-A3-03).
- Téléphone du payeur, même masqué : jamais dans l'admin.
- Purge des paiements : aucune (pièces comptables).

**Périmètre réel** : webhook, cœur de `application.ts`, rappels (`pertinence.ts`, `email-outbox.ts`), schéma. `regression-checker` obligatoire.

## 2. Décisions (le défaut s'applique ; ⚠️ = à trancher par l'utilisateur)

- **D-A3-01 « Encaissé »** = somme de `paiements.montant` pour `source='kpay' AND statut='reussi'`, bornée par `applique_le` dans le mois (fuseau `Africa/Douala`). Montant brut payé par le client. Les `manuel` et les jours `offert` sont affichés à part. `cree`, `en_attente`, `expire`, `echoue` ne sont jamais comptés.
- **D-A3-02 Brut ou net (#13 non tranchée)** : le montant appliqué reste `montant` (comportement actuel). Les cartes de revenus portent la mention « Montant brut présumé, non confirmé par K-PAY ». Le net n'apparaît que lorsque `net_reel` est renseigné par une interrogation, étiqueté « net K-PAY ». Une anomalie `MONTANT_INCOHERENT` reste finale : aucun rouvrement automatique (hors périmètre). ⚠️ Vérifier le format du webhook avec la sandbox (CA25 de S10) avant la production.
- **D-A3-03 Marquage manuel** = création d'un paiement `source='manuel'`, `methode='manuel'`, `fournisseur='manuel'`, référence `manuel-<id>`. Conditions, toutes requises :
  - le paiement visé est `echoue`, `expire`, `annule` ou `anomalie` (jamais `reussi`) ;
  - s'il a un identifiant fournisseur ou `initiation_incertaine=true`, une revérification de moins de 30 minutes doit avoir conclu « non réussi » (`journal_admin`, `paiement.reverifier`) ;
  - aucun paiement `cree` ou `en_attente` pour cet utilisateur (sinon 409 `PAIEMENT_OUVERT`).
  Montant = celui du paiement d'origine (prix vu par le client, pas la grille du moment). Le paiement d'origine passe à `anomalie` (code `REMPLACE_PAR_MANUEL`). Réauthentification `*`, clé d'idempotence obligatoire. ⚠️ Pas de reçu e-mail.
- **D-A3-04 Revérification** = `consulter` puis `appliquerEvenement` (même chemin que le webhook, source `interrogation`). Elle consomme le budget K-PAY partagé : 503 `FOURNISSEUR_INDISPONIBLE` si épuisé. Limite admin : 10 par minute. Clé d'idempotence obligatoire.
- **D-A3-05 Webhooks refusés** : compteur horaire (table `webhooks_refuses`), motifs `SIGNATURE_INVALIDE` et `CORPS_TROP_GROS`. Aucun contenu, aucune IP, aucun en-tête. `FOURNISSEUR_INCONNU` n'est pas compté (bruit des scanners). Rétention 90 jours. Écriture best-effort : une erreur de comptage ne change jamais la réponse 401.
- **D-A3-06 Abonnement offert** : `abonnements.origine` vaut `offert` seulement si l'abonnement est créé par une offre. Une offre sur un abonnement payant laisse `origine='paiement'`. `plan` ne change pas.
- **D-A3-07 « Rappeler maintenant »** : occurrence `manuel:<ISO>`, type `abonnement_rappel`, catégorie `transactionnel`. Limite d'un envoi par 24 heures et par abonnement, vérifiée sous verrou consultatif. Refusé si l'abonnement est échu. Nécessite l'extension de `analyserOccurrenceRappel` et de `pertinence` (voir §5).
- **D-A3-08 Taux de renouvellement** : reporté (A4).
- **D-A3-09 Export** : `POST /api/admin/export/paiements`, motif dans le corps (≥ 5 caractères), 5 000 lignes au plus (422 au-delà). Les cellules commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot reçoivent une apostrophe en préfixe. Journal `export.paiements`, sans contenu. L'e-mail du titulaire est exporté pour les comptes existants et vide pour les comptes supprimés. ⚠️ Réauthentification de l'export : non (motif seul).
- **D-A3-10 Numéro du payeur** : jamais exposé, même masqué. L'opérateur est affiché.
- **D-A3-11 Conservation** : aucune purge des paiements. ⚠️ Durée légale à trancher avec un conseil juridique.
- **D-A3-12 Indicateur de réussite** = vitrines publiées (`publiee_le` renseigné) ayant au moins une vue (`vues.jour` sur 30 jours) ou une réservation créée sur 30 jours. Le dénominateur (vitrines publiées) est affiché.
- **D-A3-13 Alertes** (seuils par défaut) : paiement ouvert depuis plus de 60 minutes ; plus de 10 webhooks refusés sur 1 heure ; incohérences ; encaissement tardif ignoré (`STATUT_FINAL`) sur 7 jours.
- **D-A3-14 Onglets d'abonnements** (avec `now` passé en argument, fonction pure) :
  - renouvellement : `now < expire_le <= now + 7 j` ;
  - grâce : `now - 7 j < expire_le <= now` ;
  - expirés : `now - 37 j < expire_le <= now - 7 j`.
  Ces trois ensembles forment une partition sans recouvrement.

## 3. Migration `0030_a3_paiements_admin.sql`

```sql
-- 1. paiements.source (kpay | manuel). Les lignes existantes sont K-PAY.
ALTER TABLE "paiements" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'kpay';--> statement-breakpoint
ALTER TABLE "paiements" DROP CONSTRAINT IF EXISTS "paiements_source_check";--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_source_check" CHECK ("source" IN ('kpay','manuel')) NOT VALID;--> statement-breakpoint
ALTER TABLE "paiements" VALIDATE CONSTRAINT "paiements_source_check";--> statement-breakpoint
-- 2. Cohérence : K-PAY <=> fournisseur kpay. Un manuel n'a ni identifiant ni frais, et sa référence est 'manuel-' || id.
--    Les index uniques (fournisseur, id_fournisseur) et (fournisseur, reference_fournisseur) sont INCHANGÉS :
--    un manuel ne peut pas entrer en collision avec une référence K-PAY (fournisseur différent).
ALTER TABLE "paiements" DROP CONSTRAINT IF EXISTS "paiements_source_coherence_check";--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_source_coherence_check" CHECK (
  ("source" = 'kpay') = ("fournisseur" = 'kpay')
  AND ("source" = 'kpay' OR (
    "fournisseur" = 'manuel' AND "methode" = 'manuel' AND "statut" IN ('cree','reussi')
    AND "id_fournisseur" IS NULL AND "reference_fournisseur" = 'manuel-' || "id"
    AND "frais_taux_pb" = 0 AND "frais_estimes" = 0 AND "net_estime" = "montant"
    AND "code_echec" IS NULL AND "initiation_incertaine" = false
  ))
) NOT VALID;--> statement-breakpoint
ALTER TABLE "paiements" VALIDATE CONSTRAINT "paiements_source_coherence_check";--> statement-breakpoint
-- 3. Index des listes, des onglets et des revenus.
CREATE INDEX IF NOT EXISTS "paiements_liste_admin_idx" ON "paiements" ("statut", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paiements_encaisse_idx" ON "paiements" ("devise", "applique_le") WHERE "statut" = 'reussi';--> statement-breakpoint
-- 4. (supprimé : `abonnements.origine` et son CHECK sont livrés par la migration 0029 d'A2, valeurs
--    'paiement' | 'offert' | 'admin'. A3 NE LA RECRÉE PAS : décision du thread principal, 2026-11-14.)
-- 5. Compteur des webhooks refusés : une ligne par heure, fournisseur et motif. Aucun corps, aucune IP.
CREATE TABLE IF NOT EXISTS "webhooks_refuses" (
  "heure" timestamp with time zone NOT NULL,
  "fournisseur" text NOT NULL CHECK ("fournisseur" ~ '^[a-z0-9_-]{1,40}$'),
  "motif" text NOT NULL CHECK ("motif" IN ('SIGNATURE_INVALIDE','CORPS_TROP_GROS')),
  "nombre" integer NOT NULL DEFAULT 1 CHECK ("nombre" >= 1),
  PRIMARY KEY ("heure", "fournisseur", "motif")
);--> statement-breakpoint
-- ROLLBACK manuel (impossible une fois une ligne source='manuel' créée : restaurer depuis la sauvegarde) :
-- DROP TABLE "webhooks_refuses";
-- DROP INDEX "paiements_liste_admin_idx"; DROP INDEX "paiements_encaisse_idx";
-- ALTER TABLE "paiements" DROP CONSTRAINT "paiements_source_coherence_check";
-- ALTER TABLE "paiements" DROP CONSTRAINT "paiements_source_check"; ALTER TABLE "paiements" DROP COLUMN "source";
```

Drizzle (`shared/db/schema.ts`) : `paiements.source` (`text('source').notNull().default('kpay')`), table `webhooksRefuses` (`abonnements.origine` existe déjà : migration 0029 d'A2) avec clé primaire composite. Un second `pnpm db:generate` doit répondre « No schema changes ». Ajouter les actions `paiement.reverifier`, `paiement.marquer_paye`, `abonnement.rappeler`, `export.paiements` dans `ADMIN_ACTIONS` (cibles `paiement`, `abonnement`, `export`).

Requêtes de détection (incohérences, bornées à 20 identifiants) :
```sql
-- Paiement confirmé sans abonnement prolongé
SELECT p.id FROM paiements p LEFT JOIN abonnements a ON a.user_id = p.user_id
WHERE p.statut = 'reussi' AND p.user_id IS NOT NULL
  AND (a.id IS NULL OR a.expire_le < p.abonnement_expire_apres) LIMIT 20;
-- Abonnement payant actif sans paiement correspondant
SELECT a.id FROM abonnements a
WHERE a.origine = 'paiement' AND a.expire_le > now()
  AND NOT EXISTS (SELECT 1 FROM paiements p WHERE p.user_id = a.user_id AND p.statut = 'reussi') LIMIT 20;
```
Encaissement mensuel par devise : `SELECT devise, count(*), sum(montant), sum(frais_reels) FILTER (WHERE frais_reels IS NOT NULL) FROM paiements WHERE statut='reussi' AND source=$1 AND applique_le >= $debut AND applique_le < $fin GROUP BY devise`. Les agrégats `sum(bigint)` arrivent en chaîne : conversion avec `Number.isSafeInteger`.

## 4. Service unique de confirmation

`server/services/paiements/confirmation.ts` :

```ts
confirmerPaiement(tx: DbTransaction, paiementId: string, now: Date, complements: ComplementsConfirmation):
  Promise<'applique' | 'deja_applique' | 'refuse_anomalie'>
```

Étapes, dans UNE transaction, dans cet ordre de verrous (paiement, puis utilisateur) :
1. `SELECT … FOR UPDATE` du paiement.
2. `statut='reussi'` → `deja_applique` (aucune écriture, aucune prolongation).
3. `statut='anomalie'` → `refuse_anomalie`.
4. Sinon (`cree`, `en_attente`, `expire`, `echoue`, `annule`) : `prolonger(tx, userId, periodeMois, now, id)` (verrou consultatif par utilisateur, existant), mise à jour `statut='reussi'`, `applique_le`, `termine_le`, `abonnement_expire_avant/apres`, puis `complements` (identifiants, frais réels).
5. Reçu `paiement_confirme` seulement si `source='kpay'` (D-A3-03).

`appliquerEvenement` (`application.ts:305`) garde la décision, le journal de déduplication (`journaliser`, lignes 254–297) et délègue l'écriture de succès à `confirmerPaiement` (remplace `ecrireSucces`, `application.ts:181`).

Marquage manuel (`server/services/paiements/manuel.ts`), dans une transaction : vérifications D-A3-03, `UPDATE` de l'original vers `anomalie`, `INSERT` du paiement manuel en `cree`, puis `confirmerPaiement`. Cette séquence garantit qu'un encaissement tardif de K-PAY sur l'original est journalisé `ignore` (`STATUT_FINAL`), sans prolongation.

Idempotence des routes admin : `journal_admin` garde `(admin_id, cle_idempotence)` unique. Avant toute écriture, le service relit cette clé : si elle existe, il renvoie le résultat enregistré (`rejoue: true`), sans rappeler K-PAY ni prolonger.

## 5. Backend

**Fichiers**
- Nouveaux : `server/services/paiements/confirmation.ts`, `server/services/paiements/manuel.ts`, `server/services/admin/paiements.ts` (liste, détail, revenus, alertes, export), `server/services/admin/abonnements.ts` (onglets, rappel), `server/services/webhooks-refuses.ts` (comptage, purge), `server/jobs/webhooks-refuses.ts` (purge quotidienne, file `maintenance`), `server/resources/admin-paiements.ts`, `shared/schemas/admin-paiements.ts`.
- Modifiés : `server/services/paiements/application.ts` (`ecrireSucces` délègue), `server/services/webhooks-paiement.ts` (comptage avant `UnauthorizedError` ligne 110, avant `ContentTooLargeError` ligne 146), `server/services/notifications/pertinence.ts` (`analyserOccurrenceRappel` accepte `manuel:<ISO>`, jours calculés à l'envoi), `server/services/email-outbox.ts` (`prepareRappelAbonnement`, ligne 786), `shared/admin.ts` (actions), `shared/limites.ts` (limites admin, rétention 90 j), `shared/jobs.ts` (job de purge), `shared/erreurs.ts` (`PAIEMENT_OUVERT`, `DEJA_PAYE`, `REVERIFICATION_REQUISE`, `RAPPEL_RECENT`, `EXPORT_TROP_GRAND`).

**Routes** (`defineApiHandler`, `requireSuperadmin` en premier, entrée et sortie Zod `.strict()`, réponse construite champ par champ) :

| Méthode et route | Entrée | Réauth | Journal |
|---|---|---|---|
| GET `/api/admin/abonnements?onglet&page` | onglet ∈ renouvellement, grace, expires | non | non |
| POST `/api/admin/abonnements/[id]/rappel` | `{ motif }` | non | `abonnement.rappeler` |
| GET `/api/admin/paiements?statut&source&devise&du&au&page` | filtres | non | non |
| GET `/api/admin/paiements/[id]` | | non | non |
| POST `/api/admin/paiements/[id]/reverifier` | `{ motif, cleIdempotence }` | non | `paiement.reverifier` |
| POST `/api/admin/paiements/[id]/marquer-paye` | `{ motif, cleIdempotence }` + en-tête `X-Admin-Reauth` | `*` | `paiement.marquer_paye` |
| GET `/api/admin/revenus` | | non | non |
| GET `/api/admin/alertes` | | non | non |
| POST `/api/admin/export/paiements` | `{ motif, filtres }` | non | `export.paiements` |
| GET `/api/admin/vue-ensemble` (enrichi, A1) | | non | non |

`marquer-paye` appelle `exigerReauth(event, tx, adminId, preuve)` dans la transaction, avec `('paiement.marquer_paye', 'paiement', id)`. Si l'original est déjà `reussi` ou d'origine manuelle, 409.

**Sorties** : `paiement` expose `id`, `reference`, `fournisseur`, `source`, `methode`, `operateur`, `statut`, `plan`, `periodeMois`, `devise`, `montant`, `fraisReels`, `netReel`, `codeEchec`, dates, `utilisateur` (`id`, `email` du titulaire, `null` si supprimé). Il n'expose ni téléphone, ni numéro, ni `telephone_*`. `evenements_paiement` ne sort que `evenement`, `source`, `traitement`, `motif`, `recuLe`.

**Revenus** : par devise, sans addition entre devises. Par devise : `mois.courant` et `mois.precedent` (brut, nombre, frais réels connus et nombre sans frais, `source` kpay et manuel séparés), `offerts` (jours et nombre, lus dans `journal_admin` `abonnement.offrir`, `apres.jours`), `abonnesActifs`, répartition par `periodeMois` (1, 3, 12) sur 12 mois. Mention d'incertitude (D-A3-02) dans chaque réponse.

**Alertes** : `paiementsEnAttente` (ouverts depuis plus de 60 min), `webhooksRefuses1h` (somme de `nombre` sur l'heure courante et la précédente), `incoherences` (deux requêtes de §3, identifiants bornés à 20), `encaissementsTardifs` (`evenements_paiement` `ignore` `STATUT_FINAL` sur 7 jours).

**Erreurs** : 503 `FOURNISSEUR_INDISPONIBLE` (budget K-PAY), `REAUTH_*` (A1), 409 `PAIEMENT_OUVERT`, `DEJA_PAYE`, `REVERIFICATION_REQUISE`, `RAPPEL_RECENT`, 422 `EXPORT_TROP_GRAND`.

**Comptage** : `enregistrerRefusWebhook(fournisseur, motif, now)` fait `INSERT … ON CONFLICT (heure, fournisseur, motif) DO UPDATE SET nombre = nombre + 1`, `heure = date_trunc('hour', now)`. Il ne reçoit ni corps ni en-têtes. Dans un `try/catch` : l'erreur est journalisée (motif seul), la réponse reste `401`.

**Rappel manuel** : occurrence `manuel:<ISO>`. La vérification de la limite de 24 heures lit `emails_transactionnels` (`type='abonnement_rappel'`, `occurrence LIKE 'manuel:%'`, `entite_id` = abonnement, `created_at > now − 24 h`) sous `pg_advisory_xact_lock(hashtextextended('rappel-admin:' || id))`. Le jour restant est calculé à l'envoi, à partir de `expire_le`.

## 6. Frontend

- `app/pages/admin/abonnements/index.vue` : `UTabs` à trois onglets (« À renouveler dans 7 jours », « En grâce », « Expirés récemment (30 jours) »), onglet dans `?onglet=`. `UTable` : utilisateur (e-mail), plan, devise, échéance, état (`UBadge`), origine, dernier paiement. Action « Envoyer un rappel » : `UModal` avec motif, puis `UEmpty` si la liste est vide.
- `app/pages/admin/paiements/index.vue` : filtres (`UFormField` statut, source, devise, période), `UTable`, détail dans `USlideover` (tiroir) avec `?id=`. Actions « Revérifier » (motif) et « Marquer comme payé » (motif, puis code de réauthentification via `UPinInput`, puis clé d'idempotence générée à l'ouverture de la boîte). Export CSV : bouton et motif.
- Revenus : une `UCard` par devise, colonnes « Encaissé K-PAY », « Manuel », « Jours offerts », répartition 1/3/12 mois, mention d'incertitude.
- `app/pages/admin/index.vue` (vue d'ensemble) : compteurs (inscrits, vitrines publiées, abonnés payants, revenus par devise, indicateur de réussite) et un seul `UBanner` d'alertes (un seul message à l'écran).
- Icônes Phosphor (`i-ph-*`). Aucune couleur en dur (tokens du thème). Vouvoiement, « vitrine ». Pages `ssr:false` (comme A1).

## 7. Critères d'acceptation (base PostgreSQL réelle)

- **CA01** Given un paiement K-PAY `reussi` appliqué une fois. When la revérification est relancée 3 fois avec 3 clés différentes. Then `expire_le` ne bouge qu'à la première application, les appels suivants renvoient `deja_applique`. Preuve collée.
- **CA02** Given un paiement `en_attente` et le fournisseur `completed`. When deux revérifications s'exécutent en parallèle. Then une seule prolongation, un seul reçu.
- **CA03** Given un paiement `echoue` sans identifiant fournisseur, réauth valide, clé neuve. When marquage manuel. Then un paiement `manuel` `reussi` existe, `abonnements.expire_le` est prolongé d'une période, l'original est `anomalie` (`REMPLACE_PAR_MANUEL`), une ligne `paiement.marquer_paye` existe. Rejouer la même clé : même réponse, aucune seconde prolongation.
- **CA04** Given un marquage sans réauth → `REAUTH_REQUISE`. Avec un code déjà consommé → `REAUTH_INVALIDE`. Given un paiement `reussi` ou un paiement `cree` ouvert chez le même utilisateur → 409.
- **CA05** Given un marquage manuel réussi sur l'original. When K-PAY envoie ensuite `payment.completed` pour l'original. Then journal `ignore` `STATUT_FINAL`, aucune prolongation supplémentaire.
- **CA06** Given des abonnements à `now+3 j`, `now−2 j`, `now−20 j`, `now−40 j`, `now+30 j` (horloge fixée). Then onglets : renouvellement, grâce, expirés, aucun.
- **CA07** Given des paiements `reussi` en XAF et en EUR le même mois, plus un `manuel`, un `offert` et un `expire`. Then deux cartes séparées ; `manuel` et offerts hors « Encaissé K-PAY » ; `expire` absent ; aucune somme entre devises.
- **CA08** Given une incohérence fabriquée (paiement `reussi` sans abonnement prolongé ; abonnement payant actif sans paiement). Then les deux sont détectées. Un abonnement `offert` n'est pas signalé.
- **CA09** Given un webhook de signature invalide. Then `401`, `webhooks_refuses` +1 pour l'heure courante, colonnes limitées à `heure`, `fournisseur`, `motif`, `nombre` (test de schéma).
- **CA10** Export : seules les colonnes listées ; filtres reflétés ; une cellule `=HYPERLINK(...)` sort `'=HYPERLINK(...)` ; compte supprimé → e-mail vide ; ligne `export.paiements` sans contenu.
- **CA11** Given un abonnement échu. Then rappel refusé (409). Given un abonnement actif. Then un rappel (202) puis un second (409 `RAPPEL_RECENT`) ; deux demandes simultanées → une seule ligne d'outbox.
- **CA12** Given un paiement ouvert depuis plus de 60 minutes. Then alerte. Given un webhook invalide. Then 401 (et non 503).
- **CA13** Confidentialité : aucune sortie admin de ce sprint ne contient `telephone*`, `contenu`, `message`, ni champ visiteur. Le test de contrat échoue à l'ajout d'une route non déclarée.
- **CA14** Les cartes de revenus affichent la mention d'incertitude tant que D-A3-02 n'est pas tranchée.

## 8. Tests

- **Unitaires** (`tests/unit/admin/`) : onglets (fonction pure, `now` fixé), répartition en mois locaux, neutralisation des formules, schémas Zod stricts (clés inconnues refusées), conversion des agrégats.
- **Intégration** (`tests/integration/admin/`, base de test réelle, aucun mock de `confirmerPaiement`, `prolonger`, du journal ni de la réauthentification) : CA01–CA05, CA07–CA11. Le faux fournisseur K-PAY est une injection (`consulter` et `interpreterWebhook`), comme `RapprochementDeps`.
- **Contrat** : chaque route ajoutée à `CONTRAT` (test de confidentialité d'A1). **E2E** : onglets, tiroir, revérification, bannière. Vérifier que la CI lance ces fichiers (non vérifié).

## 9. Périmètres de fichiers

**Thread principal (avant les agents)** : `shared/admin.ts` (actions), `shared/schemas/admin-paiements.ts` (Zod stricts entrée et sortie), `shared/limites.ts` (limites de revérification 10/min, rétention 90 j, seuils d'alertes), `shared/erreurs.ts` (codes), `shared/jobs.ts` (job de purge).

**Ordre** : database (schéma et migration) → tester (tests rouges, TDD serveur) en parallèle de frontend (interface, sur les schémas partagés) → backend (vert). Puis `regression-checker` (webhook, `application.ts`, pertinence, outbox) et `reviewer` en mode opus (tier critique).

- **database** : `shared/db/schema.ts`, `server/db/migrations/0030_a3_paiements_admin.sql`, `server/db/migrations/meta/0030_snapshot.json`, `server/db/migrations/meta/_journal.json`. Rien d'autre.
- **tester** : `tests/**`, `e2e/**`, `playwright.config.ts` si besoin. Pas de code de production.
- **frontend** : `app/pages/admin/**`, `app/components/admin/**` (si nécessaire). Pas de `server/`.
- **backend** : `server/**` (hors migrations), `shared/schemas/admin-paiements.ts` n'est pas modifié (contrat fixé en amont), `server/jobs/webhooks-refuses.ts`, `server/resources/admin-paiements.ts`, fichiers listés au §5. Pas de `app/`.

## 10. Risques et questions ouvertes

- **R1 (#13, bloquant prod)** : si K-PAY envoie le net, chaque succès devient `anomalie`, final. Défaut : `MONTANT_INCOHERENT` affiché en alerte, et la prod reste verrouillée (`PAIEMENT_EN_LIGNE`). Vérifier en sandbox avant toute activation.
- **R2 (encaissement tardif)** : un encaissement K-PAY sur un paiement marqué manuellement n'est pas remboursé automatiquement. Il apparaît dans les alertes ; le remboursement reste hors périmètre (le brief l'exclut).
- **R3 (budget K-PAY)** : les revérifications admin consomment le même budget que le worker. Défaut : 10 par minute et 503 à épuisement, sans jamais bloquer le webhook.
- **R4 (compteur)** : l'écriture de comptage s'exécute avant la réponse 401, et une attaque garde le coût de la requête. Défaut : une seule ligne par heure et par motif, pas de limiteur supplémentaire. ⚠️ Un limiteur par IP peut être ajouté plus tard.
- **R5 (purge)** : rétention 90 j pour le compteur ; aucune purge des paiements (D-A3-11). ⚠️ Durée légale à confirmer.
- **R6 (ordre A2/A3)** : A2 « offrir » crée `origine='offert'`, colonne en 0030. Défaut : A2 n'écrit pas `origine` avant 0030, ou A3 passe avant A2 (recommandé). ⚠️ À arbitrer.
- **R7 (reçu manuel)** : pas de reçu e-mail pour un paiement manuel (D-A3-03). ⚠️ À confirmer.
- **R8 (verrou)** : `CREATE INDEX` sans `CONCURRENTLY` verrouille brièvement `paiements`. Acceptable à cette taille.
- **R9 (devises)** : XOF est dans `shared/paiements.ts` mais pas dans `shared/devises.ts`. À aligner avec A5.
- **R10 (rappel)** : `pertinence.ts` touche les rappels J-7/J-3/J0 ; tests de non-régression obligatoires.
