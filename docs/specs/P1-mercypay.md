# P1 — Mercy Pay en mobile money (push), contrat de fournisseur généralisé

Statut : spec validée par l'utilisateur le 2026-11-18 (feu vert donné, absent pendant l'exécution : toute décision ouverte se tranche avec la proposition de ce document et se note dans le rapport).
Tier : **critique** (paiement). Reviewer en mode sécurité. Un sprint = un domaine : paiements.
Sources : `mercy-pay.md` (export, cité `[MP:ligne]`), pages de référence `https://docs.mercy-pay.com/api/payments/create.md` et `.../account/get.md`, analyse de l'architecte du 2026-11-18. Notre code : chemins relatifs au dépôt.

## 1. Décisions (D1–D9)

| # | Décision |
|---|---|
| D1 | Mercy Pay = fournisseur principal. SasPay : **hors P1** (couverture du Cameroun non documentée). K-PAY : code conservé, désactivé sans clés. |
| D2 | Frais à notre charge (`fees.paid_by = merchant`). Prix affiché inchangé. Taux réels du compte (GET /account, sandbox) : mobile money **350 points de base** ; carte 600 pb + 200 XAF fixes (P2). |
| D3 | Carte : P2, hors P1. |
| D4 | Pas de renouvellement automatique (plans/abonnements Mercy) : hors périmètre. Le modèle prépayé (`expire_le` + grâce 7 jours) reste. |
| D5 | Migration : `paiements.source` devient `'fournisseur'` ou `'manuel'` (au lieu de `'kpay'`/`'manuel'`). |
| D6 | Reçus envoyés par nous ; l'utilisateur coupe `receipt` chez Mercy (action humaine). |
| D7 | K-PAY désactivé, code gardé, réévaluation dans 3 mois. |
| D8 | Remboursements : uniquement depuis le tableau de bord Mercy. `payment.refunded` journalisé en anomalie `REMBOURSE`, sans raccourcir l'abonnement. |
| D9 | Aucun libellé de fournisseur visible côté utilisateur : seul l'opérateur (MTN / Orange). |

## 2. Faits de l'API Mercy Pay à respecter (ne rien inventer au-delà)

- Base : `https://mercy-pay.com/api/v1`. Auth : `Authorization: Bearer mp_sandbox_…` (test) ou `mp_live_…`. La clé n'apparaît jamais dans un log, une réponse ou le dépôt.
- `POST /payments` : corps JSON `amount` (**entier, unités mineures, ≥ 1**), `currency` (XAF), `payment_method` (`mobile_money` défaut), `country` (ISO alpha-3, `CMR`), `provider` (`MTN_MOMO_CMR` | `ORANGE_CMR`), `phone` (indicatif inclus, ex. `237680000000` ; espaces et `+` retirés), `payer_name`, `payer_email`, `description` (≤ 500 ; les 22 premiers caractères sans accents = message opérateur), `metadata` (objet, ≤ 50 clés, valeurs ≤ 500 car.). **`Idempotency-Key` obligatoire** (conservée 24 h ; 409 `idempotency_key_reused` / `idempotency_key_in_use`, 400 `idempotency_key_missing`, en-tête de réponse `Idempotent-Replayed`).
- Réponse 201 `{data:{id:"pay_…", object:"payment", livemode, created, checkout_session, amount, fee_amount, net_amount, currency, payment_method, mobile_money_country, mobile_money_provider, status:"pending", failure_code, failure_reason, metadata, next_action:null}}`. `next_action` est `null` en mobile money.
- Résultat asynchrone : webhook `payment.succeeded` / `payment.failed`, ou lecture `GET /payments/{id}`.
- `failure_code` (liste dans la page « Encaisser un paiement » : `payment_not_approved`, `customer_not_eligible`, `invalid_phone_number`, `provider_temporarily_unavailable`, solde insuffisant, expiration…) : le mappage vers nos codes se fait avec une table + repli `DEFAUT`.
- Webhooks : en-tête `MercyPay-Signature: t=<secondes>,v1=<hex>[,v1=<hex>…]`, HMAC-SHA256 de `"{t}.{corps brut}"` avec le secret `whsec_…` ; tolérance **300 s** ; plusieurs `v1` pendant 24 h lors d'une rotation de secret ; enveloppe avec `id` (`evt_…`, sert à dédupliquer), `type`, `livemode`, `data`. Mercy réessaie 8 fois sur 3 jours et **désactive l'endpoint** après des échecs persistants : toute réponse non 2xx est coûteuse. Réponse attendue sous 10 s.
- Événements non liés à un paiement (`webhook.test`, `account.updated`, `provider_status.changed`, …) : répondre **200** et les journaliser `ignore`. Jamais 503 pour un type simplement non géré.
- Limites de débit : 60 écritures / min et 300 lectures / min par clé ; `Retry-After` sur 429.
- Un paiement carte refusé peut repasser de `failed` à `succeeded` [MP:3317] (P2). Un paiement mobile money sandbox : numéros de test `[MP:3900-3937]`.

## 3. Écarts avec le brief d'origine (déjà tranchés)

1. « Ajouter un fournisseur = un adaptateur + une entrée, sans migration » est faux : `paiements_source_check` (shared/db/schema.ts ~1392) vaut `source IN ('kpay','manuel')` et la cohérence (~1402-1411) dépend de `'kpay'`. Migration nécessaire (D5).
2. `confirmation.ts:79` (reçu) et `manuel.ts:74` (marquage manuel) comparent la source à K-PAY : à généraliser.
3. `verifierSignature` ne reçoit pas l'horloge (types.ts ~71) : ajouter `now` (injectable, testable).
4. Un fournisseur dont l'adaptateur renvoie `null` fait répondre 503 au webhook (server/services/webhooks-paiement.ts ~133-137). Mercy envoie des événements hors paiement : `interpreterWebhook` ne renvoie `null` que pour un schéma invalide ; tout type non géré → `statut:'autre'` → journalisé `ignore`, réponse 200.
5. Règle CLAUDE.md 4.10 cite `reference_kpay` : en réalité les index uniques génériques `(fournisseur, id_fournisseur)` et `(fournisseur, reference_fournisseur)` existent déjà (schema ~1326-1331). Mettre à jour la règle 4.10 dans CLAUDE.md (`reference_fournisseur`) — fichier à modifier par le thread principal, pas par un agent.

## 4. Changements

### 4.1 Contrat (server/services/paiements/types.ts)
- `verifierSignature(corpsBrut, entetes, now)`.
- `EvenementNormalise.environnement?: 'test' | 'live'` (champ `livemode`) ; un événement dont l'environnement diffère de celui de la clé configurée est rejeté (`ENVIRONNEMENT_INCOHERENT`) sans application.
- `interpreterWebhook` : `null` seulement si le schéma est invalide ; sinon `statut` ∈ réussi / échoué / en attente / `autre`.
- `InitiationResultat` : le champ de redirection (`redirection: {url}|null`) est **prévu dans le type** mais P1 ne l'utilise pas (mobile money = `null`) ; pas d'union carte dans P1.
- `ConfigFrais` : ajouter `fixeMinor: number` (défaut 0, inutilisé en mobile money P1). Formule : frais estimés = arrondi supérieur de `montant × taux / 10 000` + fixe. Le CHECK `net_estime = montant − frais_estimes` reste valide.

### 4.2 Adaptateur (nouveau dossier `server/services/paiements/fournisseurs/mercypay/`)
`client.ts` (fetch, délai, erreurs), `signature.ts`, `schemas.ts` (Zod stricts des réponses et événements), `constantes.ts`, `adaptateur.ts`. Mêmes conventions que `kpay/`. Aucune bibliothèque Mercy : 3 routes en `fetch` (règle 4.12 : le SDK est inutile).
- `Idempotency-Key` = notre `paiement.id` (UUID), réutilisée à l'identique pour chaque retry.
- Montant = entier XAF tel quel (règle 4.8).
- `metadata.paiement_id` = notre UUID. Le numéro de téléphone n'est jamais écrit en base ni dans les logs (comme K-PAY).
- Erreurs : 409 `idempotency_key_in_use` → `incertain/DOUBLON` ; 401 → `indisponible/AUTH` (pas de retry) ; 429 → `indisponible/LIMITE` avec `retryAfterS` lu de `Retry-After` ; 422 → `refuse` ; délai dépassé → `incertain/DELAI` + `initiation_incertaine=true`, puis rejeu avec la **même clé et le même corps**.

### 4.3 Registre, budget, frais, catalogue
- `shared/paiements.ts` : `FOURNISSEURS_PAIEMENT = ['kpay','mercypay']` ; constante `PAIEMENT_SOURCE_FOURNISSEUR = 'fournisseur'`.
- `fournisseurs/index.ts` : entrée `mercypay` (`null` sans clé) ; `decrirePaiement` : un `case` par fournisseur ; libellé sans accents ni nom de marque superflu.
- `budget.ts` : clé Redis par fournisseur ; Mercy 60 écritures / 300 lectures par minute, avec marge (≈ 40 écritures/min utilisables) ; constantes dans `shared/limites.ts` ; mode fail-closed conservé (503 `FOURNISSEUR_INDISPONIBLE` / `LIMITEUR_INDISPONIBLE`).
- `server/config/paiements.ts` : frais Mercy mobile money 350 pb, payeur marchand ; moyens `MTN_MOMO_CMR` et `ORANGE_CMR` du fournisseur `mercypay`, mêmes regex de numéro que K-PAY ; contrôle de production (clés live + PRIX à valider) étendu à tous les fournisseurs.
- Catalogue des moyens et frais (table `configuration_versions`, migration 0032, versions en ajout seul) : la migration **0034** (agent database, données idempotentes) ajoute `moyens/mercypay` v1 = `{"actifs":["mercypay:MTN_MOMO_CMR","mercypay:ORANGE_CMR"]}` et `frais/mercypay:mobile_money` v1 = `{"tauxPointsBase":350,"supporteur":"marchand"}`. Les lignes K-PAY ne sont PAS modifiées : K-PAY est désactivé par l'absence de clés (le registre renvoie `null`), pas par le catalogue. L'agent backend lit ce catalogue pour les frais et les moyens (ne pas coder les 350 pb en dur ailleurs que dans la valeur de repli de `server/config/paiements.ts`, comme pour K-PAY).

### 4.4 Variables d'environnement (shared/env.ts, sur le modèle K-PAY ; `process.env` interdit ailleurs)
Noms imposés par l'utilisateur (sa clé existe déjà dans son `.env`, que personne ne lit) :
- `MERCY_PAY_API_KEY` : regex `^mp_(sandbox|live)_[A-Za-z0-9_-]+$` (jeu de caractères non documenté : rester permissif).
- `MERCY_PAY_WEBHOOK_SECRET` : `^whsec_…`, longueur minimale ; **absent pendant le développement** (l'application n'est pas encore hébergée, le webhook n'est pas déclaré).
- `MERCY_PAY_BASE_URL` : défaut `https://mercy-pay.com/api/v1`, HTTPS en production.
- `MERCY_PAY_MODE_TEST_AUTORISE` : booléen, faux par défaut.
Règles croisées en production : clé `mp_sandbox_` refusée sans le drapeau ; clé sans secret de webhook refusée ; le message d'erreur ne contient jamais la clé.
Sans `MERCY_PAY_WEBHOOK_SECRET` en dehors de la production : l'initiation fonctionne, le rapprochement par interrogation (§4.6) assure le résultat, la route webhook répond **401** `SIGNATURE_INVALIDE` (jamais 200) tant qu'aucun secret n'est configuré.

### 4.5 Schéma — migration `0033` (agent database seul)
- `UPDATE paiements SET source='fournisseur' WHERE source='kpay'`, défaut `'fournisseur'`.
- `paiements_source_check` : `source IN ('fournisseur','manuel')` ; cohérence (≈1402-1411) : `source = 'fournisseur' OR (…manuel…)`. Poser en `NOT VALID` puis `VALIDATE CONSTRAINT`, sur le modèle de `0030_a3_paiements_admin.sql`. Migration réversible (down documenté).
- Aucune nouvelle colonne : `id_fournisseur` (= `pay_…`) et `reference_fournisseur` existent. `evenements_paiement` inchangé (le format d'événement accepte `payment.succeeded`).
- Constante `PAIEMENT_SOURCE_FOURNISSEUR` côté code ; plus aucune comparaison littérale `'kpay'` pour décider du comportement (reçu, marquage manuel, admin).

### 4.6 Rapprochement, admin, e-mails
- Rapprochement (déjà prévu pour K-PAY) : lecture `GET /payments/{id}` quand le webhook n'arrive pas ; `source='interrogation'` dans `evenements_paiement`.
- Admin : filtre/libellé par fournisseur dans les revenus (les agrégats par devise existants fonctionnent sans changement). `budget.ts`, `manuel.ts`, `confirmation.ts` généralisés.
- E-mails de rappel et grâce : inchangés (renouvellement manuel).

## 5. Critères d'acceptation (Given/When/Then) — [U] unitaire, [PG] intégration contre la vraie base PostgreSQL et Redis ; Mercy simulé par un **faux serveur HTTP local** (127.0.0.1), jamais mocké au niveau du repository

- **CA-M01 [U]** Signature valide : secret `whsec_test`, corps B, `t = now` ; en-tête `t=<now>,v1=HMAC-SHA256(t+"."+B)` → `verifierSignature(B, en-têtes, now)` = vrai.
- **CA-M02 [U]** `t = now−301 s` → faux ; `t = now−299 s` → vrai.
- **CA-M03 [U]** Deux `v1` dont un seul calculé avec notre secret → vrai ; aucun `v1` correspondant, ou `v1` de longueur différente → faux, sans exception (comparaison en temps constant).
- **CA-M04 [PG]** Corps resérialisé (un espace ajouté) avec la signature d'origine → POST `/api/webhooks/mercypay` = 401 `SIGNATURE_INVALIDE`, compteur `webhooks_refuses(mercypay, SIGNATURE_INVALIDE)` +1, aucun `evenements_paiement`.
- **CA-M05 [PG]** Initiation : paiement P (UUID) sur `mercypay:MTN_MOMO_CMR`, 5000 XAF ; le faux serveur reçoit POST /payments avec `Authorization: Bearer mp_sandbox_…`, `Idempotency-Key: <P.id>`, `amount: 5000` (entier), `currency: XAF`, `country: CMR`, `provider: MTN_MOMO_CMR`, `metadata.paiement_id = P.id` ; sur 201 `{id:"pay_x", status:"pending"}` → P `en_attente`, `id_fournisseur='pay_x'` en base ; le téléphone n'apparaît ni en base ni dans les journaux.
- **CA-M06 [PG]** Délai dépassé au premier appel → `incertain/DELAI`, `initiation_incertaine=true` ; rejeu avec la même clé et le même corps → le faux serveur renvoie la réponse d'origine (`Idempotent-Replayed: true`) ; un seul `pay_x` ; P rattaché.
- **CA-M07 [U]** 409 `idempotency_key_in_use` → `incertain/DOUBLON` ; 401 → `indisponible/AUTH` ; 429 avec `Retry-After: 12` → `indisponible/LIMITE`, `retryAfterS=12` ; 422 → `refuse`.
- **CA-M08 [PG]** Webhook signé `payment.succeeded` (`data.id=pay_x`, 5000 XAF, `fee_amount 175`, `net_amount 4825`, `livemode:false`) → 200 ; P `reussi`, `frais_reels=175`, `net_reel=4825` ; `abonnements.expire_le` prolongé d'une période ; `evenements_paiement` `applique` ; reçu `paiement_confirme` en outbox.
- **CA-M09 [PG]** Même événement (même `evt_…`) livré deux fois → deux 200, une seule prolongation, `expire_le` identique après la seconde.
- **CA-M10 [PG]** `payment.failed` `failure_code: insufficient_balance` → P `echoue`, `code_echec='INSUFFICIENT_BALANCE'`, message correspondant ; expiration → `code_echec='EXPIRE'` ; code inconnu → message `DEFAUT`.
- **CA-M11 [PG]** `webhook.test`, `account.updated`, `provider_status.changed` signés → **200** (jamais 503), aucun paiement modifié, événement journalisé `ignore`.
- **CA-M12 [PG]** `payment.succeeded` avec `amount 4000` pour un P à 5000 → `anomalie/MONTANT_INCOHERENT`, aucune prolongation ; `currency RWF` → `DEVISE_INCOHERENTE`.
- **CA-M13 [PG]** `livemode:true` avec une clé `mp_sandbox_` → aucune application, motif `ENVIRONNEMENT_INCOHERENT` journalisé.
- **CA-M14 [PG]** P en attente sans webhook, vérification arrivée à échéance → tick du worker : GET /payments/pay_x ; si `succeeded` → P `reussi` avec `source='interrogation'`.
- **CA-M15 [PG]** P `expire` localement puis `payment.succeeded` → abonnement prolongé **une seule fois** (comportement actuel : confirmation.ts ne bloque que `reussi` et `anomalie`).
- **CA-M16 [PG]** Migration `source` : lignes K-PAY existantes → `source='fournisseur'` ; insertion `fournisseur='mercypay', source='fournisseur'` acceptée ; `fournisseur='manuel', source='fournisseur'` refusée ; `fournisseur='mercypay', source='manuel'` refusée ; tests A3 des paiements manuels restent verts.
- **CA-M17 [U]** `NODE_ENV=production` + `MERCY_PAY_API_KEY=mp_sandbox_x` sans drapeau → refus (message sans la clé) ; clé sans `MERCY_PAY_WEBHOOK_SECRET` → refus ; `mp_live_` avec PRIX à valider → `ConfigPaiementsError`.
- **CA-M18 [PG]** 40 écritures Mercy dans la minute puis une 41ᵉ → 503 `FOURNISSEUR_INDISPONIBLE` avec `retryAfter`, aucun appel HTTP ; Redis coupé → 503 `LIMITEUR_INDISPONIBLE`.
- **CA-M19 [PG]** Paiement Mercy `echoue` marqué payé manuellement par l'admin → accepté (manuel.ts généralisé).
- **CA-M20 [U]** `fournisseursConfigures` contient `mercypay` ssi sa clé est présente ; `kpay` absent sans ses clés.
- **CA-M21 [PG]** Sans `MERCY_PAY_WEBHOOK_SECRET` (hors production) : POST `/api/webhooks/mercypay` → 401, jamais 200 ni 5xx.

## 6. Hors périmètre (P1)
Carte et checkout hébergé (P2), SasPay (P3), abonnements récurrents Mercy (P4), remboursement par API, bascule automatique entre fournisseurs au paiement (double débit), UI nouvelle (les moyens viennent du catalogue).

## 7. Reste à la charge de l'utilisateur (au déploiement)
Déclarer l'endpoint `https://<site>/api/webhooks/mercypay` côté Mercy (sandbox puis live) avec les événements `payment.*` et copier le `whsec_` dans `MERCY_PAY_WEBHOOK_SECRET` ; couper les reçus Mercy (`customer_emails.receipt = false`) ; clé `mp_live_` ; synchronisation NTP du serveur (tolérance 300 s) ; KYC Individuel = plafond mensuel (dette à surveiller).

## 8. Non vérifié faute de documentation
Corps exact de `POST /checkout_sessions` pour P2 (page récupérée, à lire en P2) ; politique de rétention des événements ; comportement exact du sandbox pour un paiement mobile money (délai avant `succeeded`) : vérifier avec un paiement sandbox de test (numéros `[MP:3900-3937]`), sans argent réel.

## 9. Ordre de déploiement et dette connue (ajouté en clôture P1)
- **Déployer la migration 0033 ET le code ensemble** : l'ancien code écrit `source = 'kpay'`, valeur refusée par le CHECK (`fournisseur`|`manuel`). Risque accepté (déploiement unique).
- Dette : champ DTO admin des revenus toujours nommé `kpay` ; ni filtre par fournisseur ni colonne fournisseur dans le CSV ; route webhook `mercypay` répond 503 tant que la clé API est absente ; remboursement = ignoré/`REMBOURSE` avec alerte console.
