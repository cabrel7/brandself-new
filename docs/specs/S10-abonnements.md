# Spec S10 : abonnements, plans et paiement Mobile Money

Branche `sprint/s10-abonnements`. **Tier critique** pour ce sprint : paiement, données personnelles (numéro du payeur), argent réel. Sécurité renforcée, revue sécurité sur opus obligatoire, tests de régression, cartographie obligatoire. Les décisions reprennent à **#103**.

## Sources lues

- **Documents** : CLAUDE.md, PROJECT_CONTEXT.md (en entier), PROJECT_STATE.md (en entier), SPRINTS.md (BLOC COMMUN, S7 à S11), docs/specs/S9-notifications.md (en entier, format repris), en-tête de S8, kpay_doc.md (Authentication, Payin, Retrieve, Webhooks, Provider catalogue, Sandbox numbers, Fees, Common errors, exemples Express et Nuxt L1311-1375, OpenAPI live), OpenAPI `kpay-openapi.json` (init, `{id}`, availability, currencies, predict-provider, currency-by-phone, schémas `InitPaymentClientDto`/`PredictProviderDto`).
- **Code** : `shared/db/schema.ts` (en entier : ni `abonnements` ni `paiements`), `shared/env.ts`, `shared/jobs.ts`, `shared/ia.ts`, `shared/compte.ts`, `shared/notifications.ts`, `shared/reserved.ts` (`tarifs` déjà réservé), `server/config/plans.ts`, `server/services/plans.ts` (PlanService S8 : `getPlanForUser` renvoie toujours `'gratuit'`), `server/services/services.ts`, `vitrine-acces.ts` (`lockVitrineId` FOR UPDATE), `vitrines.ts` (`getPublicVitrinePage`, `summarize`), `reservations.ts` (`createReservation`, transitions), `creneaux.ts` (en-tête), `ia/generations.ts` (`createGeneration`), `email-outbox.ts` (en-tête, insertion), `limiteur.ts`, `server/utils/api.ts`, `server/exceptions/http.ts`, `server/resources/vitrine.ts`, `server/jobs/{queues,ia}.ts`, `worker/index.ts`, `app/pages/studio/compte.vue`.
- **Maquettes `Studio-Compte` et `Tarifs-PC` : je ne les ai PAS trouvées.** Glob et Grep échouent dans mon environnement (`EACCES posix_spawn rg`), donc je ne peux pas lister `docs/maquettes/`. J'ai essayé ces noms, tous absents : `Tarifs-PC.png/.html`, `tarifs-pc.png`, `Tarifs · PC.png`, `Studio-Compte.png/.html`, `Studio · Compte.png`, `README.md`, `index.html`. Je n'ai rien deviné du rendu. Le lot frontend doit ouvrir les deux maquettes avant de coder, et s'arrêter si elles sont absentes (règle du BLOC COMMUN). §7 ne décrit que la structure et les états, pas le visuel.
- **Non lus, à vérifier par les lots backend** : les fonctions de création et de lecture publique de `realisations.ts` et `temoignages.ts`, la création des demandes (`demandes.ts` ou équivalent), `server/middleware/*` (aucun ne doit lire le corps de `/api/webhooks/**`), `onboarding.ts` (`terminer`), `server/db/seed.ts`.

---

## CHALLENGE

**Hypothèses implicites du brief**
- **« Lien de paiement »** (SPRINTS : `POST …/paiement` → lien). C'est faux en USSD : aucun lien n'existe. K-PAY envoie une demande sur le téléphone du payeur, puis le statut final arrive par webhook. Le contrat devient : initier, attendre, constater.
- **« Prix XAF/EUR/USD »**. Sans carte, EUR et USD ne sont pas payables. Afficher un prix qu'on ne peut pas payer serait trompeur.
- **« Tous les pays K-PAY »**. Chaque pays alimente son propre portefeuille. Retirer l'argent d'un portefeuille étranger exige le plan TopOf, payant et réservé au Live. Activer la Côte d'Ivoire ou le Sénégal bloquerait l'argent encaissé. Par défaut, seuls Orange et MTN au Cameroun sont actifs.
- **« Interroger `GET /payments/:id` toutes les 5 à 10 s »**. K-PAY plafonne à **100 requêtes par minute pour toute l'application**. Si chaque navigateur interrogeait K-PAY, 8 paiements simultanés suffiraient à épuiser le budget, et l'initiation tomberait en 429. Le navigateur interroge donc **notre** API (lecture en base). Seul le worker interroge K-PAY, avec un budget borné.
- **« Pré-requis #1 et #13 tranchés, sinon s'arrêter après la partie plans »** (SPRINTS). Ni l'un ni l'autre n'est tranché : prix non décidés, secret de webhook non fourni. Je propose de tout construire et de tout tester contre un faux serveur K-PAY local. L'activation en production est verrouillée par configuration (prix validés, secret présent). C'est conforme à l'esprit de la règle : rien ne part en production sans les décisions.

**Angles morts**
- **Le webhook ne contient pas de devise** : seulement `amount`, `externalId`, `paymentId`, `event`, `status`, `reference`, `timestamp`. On contrôle le montant de façon stricte. La devise est liée par l'`externalId` (nous l'envoyons explicitement, et K-PAY impose en USSD qu'elle soit celle de l'opérateur). Elle n'est comparée que si elle est présente.
- **On ne peut pas consulter K-PAY par `externalId`** (seulement par `id` ou `reference`). Une initiation qui dépasse le délai, ou un 409 sur un `externalId` déjà vu, laisse un paiement sans identifiant K-PAY. Seul le webhook pourra le rapprocher.
- **Un `payment.completed` signé qui arrive après notre expiration locale doit quand même activer l'abonnement** : l'argent a été prélevé.
- **En sandbox, K-PAY renvoie 400 si l'URL de rappel n'est pas configurée.** C'est un prérequis même en développement.
- **K-PAY attend une réponse 2xx en moins de 3 s**, réessaie les 5xx et jamais les 4xx. Une signature invalide donne donc un 401 définitif, et une panne de base un 500 qui sera réessayé.
- **Suppression du compte** : `users ON DELETE CASCADE` effacerait les paiements, qui sont une pièce comptable. Ils doivent survivre, détachés de l'utilisateur.
- **Abus par notification USSD** : n'importe qui peut saisir le numéro d'une victime et lui envoyer des demandes de paiement en rafale. Il faut une limite par numéro (empreinte HMAC) et refuser si le limiteur est indisponible.
- **Quotas sous concurrence** : le compteur IA S8 ne compte que les générations `terminee`, donc deux demandes simultanées dépassent la limite. Les réservations n'ont aucun verrou de quota.
- **Le quota de réservations peut être épuisé par un tiers** : 10 fausses réservations bloqueraient le professionnel gratuit. Les réservations refusées ou annulées ne comptent donc pas.
- **« Renouveler en un clic »** est impossible en USSD : il faut ressaisir le numéro (non stocké) et valider sur le téléphone. Le lien ouvre le formulaire présélectionné, et le libellé dit « Renouveler mon abonnement ».
- **Seed** : PROJECT_CONTEXT §15 impose une seule persona, et `dr-cabrel` est lue par les e2e (badge). La passer au plan payant casserait des tests.
- **Le drapeau existant `PAIEMENT_EN_LIGNE`** concerne le paiement des réservations (v1.5), pas l'abonnement. Il ne doit pas être réutilisé.

**Meilleure approche (retenue)**
1. **État d'abonnement calculé, jamais stocké.** Il découle de `expire_le` et de l'horloge : actif, grâce ou gratuit. Aucun job de transition, donc aucune dérive possible, et une horloge simulable par simple injection de `now`. Le masquage public et le badge découlent du même calcul.
2. **Fournisseur interchangeable `PaiementProvider`** (même esprit que `IaProvider`). Adaptateur `kpay` aujourd'hui ; un adaptateur carte viendra sans migration : `fournisseur` et `methode` sont du texte avec un CHECK de format, et le webhook est routé par fournisseur.
3. **Initiation synchrone**, sans job. Le numéro n'est ainsi jamais persisté, ni en base ni dans Redis (principe S8 : rien de personnel dans Redis). Le **rapprochement** passe par une file dédiée `paiements` (un tick borné). Le webhook reste l'autorité, l'interrogation n'est qu'un rattrapage.
4. **Rappels J-7, J-3 et J0 dans l'outbox S9** (planificateur unique, revalidation à l'envoi). Pas de nouvel ordonnanceur.
5. **Masquage centralisé dans un seul module SQL**, `plan-visibilite.ts`, appliqué par toutes les lectures publiques.

**À retirer ou simplifier**
- `paymentMethod: CARD`, mode Gateway, `returnUrl` : exclus.
- `availability` : sa réponse n'a aucun schéma publié, donc inutilisable de façon fiable. `predict-provider` : un appel par saisie consommerait le budget de 100/min, et seuls les numéros de test sont reconnus en sandbox. L'opérateur est choisi par l'utilisateur.
- `abonnements.devise` (PROJECT_CONTEXT §11) : supprimé, chaque paiement porte sa devise.
- `reference_kpay` : remplacé par `reference_fournisseur` + `id_fournisseur`, uniques par fournisseur.
- Factures PDF, remboursements, interface d'administration : hors périmètre.

**Périmètre réel vs demandé**
En plus du brief : journal des événements de paiement, rapprochement par le worker, plafond global d'appels K-PAY, conservation des paiements après suppression du compte, motif IA `quota_atteint`, message au visiteur quand le quota de réservations est atteint, mention « Masqué sur la vitrine » dans les listes du studio, e-mail `paiement_confirme`, verrou en production sur les prix provisoires.

**Changements par rapport au brief littéral**
- Pas de lien de paiement (#108).
- Interrogation côté serveur seulement (#109).
- EUR et USD ni affichés ni proposés tant qu'aucun moyen ne les accepte (#105).
- Seuls les pays du Cameroun sont actifs (#104).
- Route `POST /api/studio/abonnement/paiements` (au pluriel, avec moyen et numéro).
- Libellé « Renouveler mon abonnement » plutôt que « en un clic » (#122).

---

## 0. État des lieux

| Élément | Existant | À faire |
|---|---|---|
| PlanService | `server/services/plans.ts` : `getPlanForUser` renvoie `'gratuit'`, `getIaQuota` en lecture seule (compte `terminee`) | Plan effectif, quotas appliqués, comptage actives+terminées |
| Config plans | `server/config/plans.ts` : `generationsIaParMois` seul | Limites complètes, badge, statistiques, prix par devise et période |
| Tables | aucune `abonnements`/`paiements` | Migration 0021 |
| Carte Compte | statique « Plan gratuit » (`compte.vue` L82-96) | Carte réelle |
| `/tarifs` | absente (mot réservé déjà présent) | Page SSR |
| Badge | « Créé avec Brandself » toujours affiché (S2, S6) | `badgeBrandself` dans le DTO public |
| Verrous | `lockVitrineId` (services ; à vérifier pour réalisations et témoignages), verrou consultatif IA | Comptage sous verrou |
| Outbox | S9 (occurrence, revalidation) | 2 types, 2 entités |
| Env | rien pour K-PAY | 5 variables |

### Cartographie transversale « plans »

| Entité ou surface | Concernée | Décision |
|---|---|---|
| services | quota de création + masquage public | inclus |
| réalisations (+ galerie) | quota + masquage ; galerie (6) hors plan | inclus |
| témoignages | quota + masquage | inclus |
| réservations | 10 par mois, au moment de la création publique | inclus |
| demandes (devis, atelier) | aucune limite (PROJECT_CONTEXT n'en prévoit pas) ; refusées si le service est masqué | exclu du quota, masquage appliqué |
| messages de contact | aucune limite de plan | exclu |
| liens / link-in-bio | « oui / oui » pour les deux plans | exclu (badge seulement) |
| generations_ia | 3 par mois, appliqué | inclus |
| onboarding (terminer) | création de services soumise au quota | inclus (tronqué) |
| statistiques | 7 j / 90 j | config seulement, application en S11 |
| badge | accueil, services, détail, réalisations, détail, réserver, confirmation, agenda, link-in-bio | inclus |
| médias (stockage) | aucun quota | exclu (risque §8) |
| cache public (S12) | état dépendant du temps | note pour S12 |

---

## 1. Décisions par défaut (#103 à #134)

| # | Sujet | Décision |
|---|---|---|
| 103 | Fournisseur | Interface `PaiementProvider` (§5.2). Registre en configuration. Adaptateur `kpay` seul en S10 ; adaptateur carte plus tard, sans migration. Colonnes `paiements.fournisseur` (`^[a-z0-9_-]{1,40}$`) et `methode` (`^[a-z_]{1,30}$`) en texte avec CHECK de format, jamais d'enum Postgres. Valeurs connues : `FOURNISSEURS_PAIEMENT = ['kpay']`, `METHODES_PAIEMENT = ['mobile_money', 'carte']` (`carte` déclarée, aucun moyen actif). |
| 104 | Moyens proposés | Catalogue `MOYENS_PAIEMENT` dans `server/config/paiements.ts`, limité à Orange Money et MTN MoMo via K-PAY. **Actifs** : `kpay:MTN_MOMO_CMR`, `kpay:ORANGE_CMR` (XAF). **Au catalogue mais inactifs** : `ORANGE_CIV`, `MTN_MOMO_CIV`, `ORANGE_SEN`, `MTN_MOMO_BEN`, `MTN_MOMO_COG` (portefeuilles étrangers soumis à TopOf, Q2). L'interface ne propose que les moyens actifs dont le fournisseur est configuré. |
| 105 | Devises | Devises payables = devises des moyens actifs (aujourd'hui **XAF seule**). Les prix EUR et USD restent en configuration (préparés pour la carte) mais **ne sont ni affichés ni proposés**. `/tarifs` et Compte ne listent que les devises payables, avec un sélecteur seulement s'il y en a plusieurs. Aucune devise payable (clés absentes) : le paiement n'est pas proposé (« Le paiement en ligne arrive bientôt. ») ; `/tarifs` montre les plans et leurs limites, sans prix. Devise affichée par défaut : `users.devise` si elle est payable, sinon la première payable. |
| 106 | Prix | Grille **provisoire** dans `server/config/plans.ts`, avec `PRIX_STATUT = 'a_valider'`. XAF : 1 mois 5 000, 3 mois 13 500, 12 mois 48 000 (12 mois mis en avant). EUR/USD : valeurs provisoires en centimes. **En production, `PRIX_STATUT = 'a_valider'` fait échouer le démarrage** (`assertConfigPaiements`). Montants entiers, validés au démarrage (≥ minimum du moyen, exposant de la devise respecté). Remise affichée = calcul pur depuis le prix mensuel. |
| 107 | Frais | `FRAIS_PAIEMENT[fournisseur][methode] = { tauxPointsBase: 500, supporteur: 'marchand' }` (5,00 %, valeur nommée). Supporteur `marchand` : le client paie le prix du plan, et Brandself absorbe les frais. Supporteur `client` : montant majoré `⌈prix × 10000 / (10000 − taux)⌉`. Frais estimés `⌈montant × taux / 10000⌉`, arrondi **au supérieur** (prudent, en faveur de l'estimation du coût). Net = montant − frais. Calcul pur en entiers (`calculerMontants`). **Snapshot sur chaque paiement** (`montant_plan`, `montant`, `frais_taux_pb`, `frais_supporteur`, `frais_estimes`, `net_estime`) ; les frais et net réels sont lus au rapprochement (`feeAmount`, `netAmount`). Changer la configuration ne réécrit jamais l'historique. |
| 108 | Initiation | **Synchrone dans la requête** (pas de job) : le numéro n'est jamais écrit en base, dans Redis ni dans un journal. Ordre : (1) limiteurs ; (2) transaction courte qui insère la ligne `cree` (son `id` UUID devient l'`externalId`) puis commit ; (3) appel au fournisseur, délai `KPAY_DELAI_INITIATION_MS = 10_000`, sans nouvel essai ; (4) mise à jour : `en_attente` avec ids, `echoue` sur un 400, ou `en_attente` avec `initiation_incertaine = true` sur délai dépassé, 409 ou erreur réseau. Écart assumé avec la règle 5 (« opération lente = job ») : l'appel est court, l'utilisateur attend la notification sur son téléphone, et un job exigerait de placer le numéro dans Redis. **Alternative si vous la préférez** : job avec numéro chiffré (AES-GCM, clé HKDF) dans une colonne effacée après l'appel. |
| 109 | Suivi | Le **webhook signé fait autorité**. Rattrapage : file BullMQ `paiements`, ordonnanceur `paiements-verifier` toutes les `PAIEMENTS_TICK_MS = 10_000`. Il réclame les paiements dus (`FOR UPDATE SKIP LOCKED`, lot `PAIEMENTS_VERIFICATION_LOT = 5`), avance `prochaine_verification` selon `PAIEMENTS_VERIFICATION_CALENDRIER_S = [15, 30, 60, 120, 300]` (le dernier pas se répète), puis appelle `consulter()` hors transaction et applique le statut terminal par le même chemin que le webhook (`source = 'interrogation'`). Le navigateur interroge `GET /api/studio/abonnement/paiements/:id` (lecture en base) toutes les `PAIEMENT_SUIVI_INTERVALLE_MS = 5_000`, pendant `PAIEMENT_SUIVI_MAX_MS = 180_000` au plus. |
| 110 | Budget K-PAY | K-PAY plafonne à 100 requêtes/min par application. Compteur Redis global `kpay:appels`, `KPAY_APPELS_MAX_PAR_MINUTE = 60`, partagé entre initiation et vérification, **fail-closed** (503 `FOURNISSEUR_INDISPONIBLE` avec `retryAfter`). Le lot de vérification (5 toutes les 10 s, soit 30/min au plus) laisse la place à l'initiation. |
| 111 | Expiration locale | `PAIEMENT_EXPIRATION_MINUTES = 15` : au-delà, un paiement `cree` ou `en_attente` passe à `expire` (tick). **Un `payment.completed` signé ou interrogé reste appliqué à un paiement `expire`, `echoue` ou `annule`** (l'argent a été pris). `failed` et `cancelled` ne s'appliquent qu'à `cree`, `en_attente` et `expire`. |
| 112 | Route webhook | `POST /api/webhooks/[fournisseur]`. Fournisseur hors registre : 404. Secret absent : 503 `WEBHOOK_NON_CONFIGURE` (K-PAY réessaiera). Corps lu brut en `Buffer` (`readRawBody(event, false)`), plafonné à `WEBHOOK_CORPS_MAX_OCTETS = 16_384` : `Content-Length` vérifié avant la lecture, longueur réelle vérifiée après, sinon 413. Signature vérifiée **avant** tout parsing. Signature absente ou invalide : 401 `{ code: 'SIGNATURE_INVALIDE' }`, sans autre détail. JSON illisible ou schéma invalide après une signature valide : 400. Traitement **synchrone dans une transaction** (moins de 3 s). Réponse **200 `{ recu: true }` identique** pour appliqué, doublon, ignoré ou anomalie (aucun oracle). |
| 113 | Déduplication | Table `evenements_paiement`, unicité `(fournisseur, id_transaction, evenement)`. Insertion `ON CONFLICT DO NOTHING` dans la même transaction que l'application : un conflit veut dire doublon, donc 200 sans effet ; un rollback efface le journal, donc le réessai de K-PAY fonctionne. `source` vaut `webhook` ou `interrogation` (une interrogation qui a appliqué `completed` fait du webhook suivant un doublon). |
| 114 | Contrôles anti-fraude | Sous `SELECT … FOR UPDATE` du paiement par `externalId` : paiement connu (sinon journal `ignore`/`PAIEMENT_INCONNU`) ; `amount === paiements.montant` ; `id_fournisseur` égal s'il est déjà connu (sinon renseigné) ; devise égale si le corps en contient une ; environnement de la clé cohérent. Tout écart : statut `anomalie`, `code_echec` (`MONTANT_INCOHERENT`, `ID_INCOHERENT`, `DEVISE_INCOHERENTE`), **aucune activation**, 200, journal d'alerte en codes seulement. |
| 115 | Statuts | `cree → en_attente | echoue | expire` ; `en_attente → reussi | echoue | annule | expire | anomalie` ; `expire | echoue | annule → reussi | anomalie` (completed tardif). `reussi` et `anomalie` sont finaux. Fonction pure `transitionPaiement(statut, evenementNormalise)`. Correspondance K-PAY : `PENDING`, `PROCESSING`, `SUBMITTED` = non terminal ; `COMPLETED` → reussi ; `FAILED` → echoue (`failureReason` → `code_echec`) ; `CANCELLED` → annule ; `REFUNDED` → journal `ignore`/`REMBOURSE` + alerte (Q10). |
| 116 | Numéro du payeur | Normalisé selon le pays du moyen (CMR : `^(?:\+?237)?\s*(6\d{8})$` → `2376XXXXXXXX`), envoyé au fournisseur au format international à 12 chiffres sans `+`. **Jamais stocké en clair.** On garde `telephone_masque` (indicatif + 2 derniers chiffres, ex. `+237 6•• ••• •89`, CHECK : contient `•`) pour l'affichage et le support, et `telephone_empreinte` = HMAC-SHA256 (clé HKDF de `NUXT_BETTER_AUTH_SECRET`, info `brandself-telephone-paiement-v1`) pour la limite par numéro. Aucun journal ne contient le numéro ni le corps d'une réponse K-PAY (qui renvoie `phoneNumber`). |
| 117 | Abus | Initiation : `PAIEMENT_INIT_LIMIT_UTILISATEUR = 5 / 900 s`, `PAIEMENT_INIT_LIMIT_NUMERO = 3 / 900 s`, fail-closed. Au plus `PAIEMENTS_OUVERTS_MAX = 2` paiements `cree` ou `en_attente` par utilisateur ; une nouvelle initiation est refusée (409 `PAIEMENT_EN_COURS` avec l'id du plus récent) tant que celui-ci a moins de `PAIEMENT_RELANCE_APRES_S = 60` s. Suivi : `PAIEMENT_SUIVI_LIMIT = 60 / 60 s` par utilisateur. |
| 118 | Clés | `KPAY_API_KEY` (`^kpay_(test|live)_[A-Za-z0-9_-]+$`), `KPAY_SECRET_KEY` (64 hex), `KPAY_WEBHOOK_SECRET` (≥ 16 caractères), `KPAY_BASE_URL` (défaut `KPAY_BASE_URL_DEFAUT = 'https://admin.kpay.site'` ; https obligatoire en production ; `http://127.0.0.1` ou `localhost` permis hors production pour le faux serveur), `KPAY_MODE_TEST_AUTORISE` (booléen, défaut false). Environnement déduit du préfixe. En production : clé `kpay_test_` interdite sauf `KPAY_MODE_TEST_AUTORISE=true`, et secret webhook obligatoire si les clés sont présentes. Les clés vont ensemble (les deux ou aucune). Fournisseur « configuré » ⇔ clés présentes. Les clés ne sont jamais dans `runtimeConfig.public` ni dans un DTO ni dans un journal. |
| 119 | Modèle d'abonnement | Une ligne `abonnements` par utilisateur (unique). `expire_le` est **exclusif** et aligné sur le minuit local suivant le dernier jour payé (fuseau `users.fuseau`, repli `Africa/Douala` si invalide). État calculé par la fonction pure `resoudrePlanEffectif(abonnement, now)` : `now < expire_le` → actif ; `now < expire_le + 7 jours` → grâce ; sinon gratuit. Aucun job de transition. |
| 120 | Prolongation | Sous `FOR UPDATE` de l'abonnement : base = `max(now, expire_le)` ; plus N mois civils (Temporal, `overflow: 'constrain'`) ; arrondi au minuit local suivant (sauf si déjà minuit). En grâce ou en gratuit, on repart de `now` : la grâce n'est pas facturée. Snapshot `abonnement_expire_avant/apres` et `applique_le` sur le paiement. Un paiement n'applique qu'une fois (`applique_le IS NULL` sous verrou). |
| 121 | Grâce | `ABONNEMENT_GRACE_JOURS = 7` : les droits du payant sont **conservés** (pas de badge, pas de masquage, quotas illimités) et un bandeau unique s'affiche dans le studio. Ensuite, retour au gratuit sans aucune suppression. |
| 122 | Rappels | Outbox S9, entité `abonnement`, type `abonnement_rappel`, `occurrence = J{7|3|0}:{expire_le ISO}` (≤ 32 caractères). J0 = dernier jour inclus (date locale de `expire_le − 1 jour`). Envoi à `ABONNEMENT_RAPPEL_HEURE_LOCALE = 9`, rattrapage `ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES = 6`. Planifié par une nouvelle fonction appelée depuis `planifierNotifications` (tick S9 de 5 min). Catégorie `transactionnel`. Revalidé à l'envoi : renouvelé → `annule`/`ABONNEMENT_RENOUVELE` ; échéance passée → `RAPPEL_PERIME`. Lien « Renouveler mon abonnement » vers `{site}/studio/compte?periode={dernière}#abonnement`. |
| 123 | Reçu | Type `paiement_confirme` (entité `paiement`), inséré dans la transaction qui applique le paiement. Récapitulatif texte : montant, période, moyen, numéro masqué, référence, nouvelle échéance. « Ce récapitulatif n'est pas une facture. » |
| 124 | Quotas | PlanService unique (`assertQuota`). Comptages : services, réalisations, témoignages = **toutes les lignes** de la vitrine, visibles ou non (sinon masquer pour recréer contournerait la limite) ; réservations du mois = statuts `en_attente`, `confirmee`, `terminee` créés dans le mois civil du fuseau de la vitrine (refus et annulations exclus) ; IA = `terminee` + `en_attente`/`en_cours` non expirées, dans le mois civil de `users.fuseau`. Verrous : `lockVitrineId` (listes, vérifié pour services, à ajouter s'il manque ailleurs) ; `pg_advisory_xact_lock(hashtextextended('quota-reservations:'‖vitrine_id,0))` seulement si le plan est limité ; `pg_advisory_xact_lock(hashtextextended('quota-ia:'‖user_id,0))` avant le dédoublonnage IA. |
| 125 | Erreur de limite | 403 `LIMITE_PLAN_ATTEINTE`, `data: { code, ressource, limite, utilise, plan: 'gratuit' }`. Le texte de déblocage vient de `LIMITE_MESSAGES[ressource]` (shared). Pour le visiteur : 409 `RESERVATIONS_INDISPONIBLES` (« Ce professionnel ne prend plus de nouvelle réservation en ligne ce mois-ci. Vous pouvez le contacter directement. »), sans jamais mentionner un plan. `creneaux` renvoie `{ creneaux: [], suspendues: true }`. |
| 126 | Onboarding | Génération `onboarding_vitrine` au-delà du quota : **repli** `quota_atteint` (nouveau motif, transitoire), jamais de blocage. `terminer` crée au plus le nombre de services restant au quota ; les autres sont ignorés (jamais d'échec de publication). |
| 127 | Masquage public | Module unique `server/services/plan-visibilite.ts`. Au-delà de la limite du plan effectif, seuls les **N plus anciens** éléments actifs (`created_at, id` croissants) restent visibles ; l'ordre d'affichage est inchangé. Appliqué aux listes, détails (404 si masqué), compteurs de navigation, agenda, créneaux, création de réservation et de demande. Studio : champ `masqueParPlan` par élément, étiquette « Masqué sur la vitrine ». Masquer un ancien élément au studio libère sa place pour un plus récent : l'utilisateur garde la main. Réapparition automatique au renouvellement. |
| 128 | Badge | `VitrinePubliqueDTO.badgeBrandself: boolean` = `PLANS[plan].badge` (gratuit oui ; actif et grâce non). Le statut d'abonnement n'est jamais exposé publiquement. |
| 129 | Rétention | `paiements.user_id` et `evenements_paiement.paiement_id` en `ON DELETE SET NULL` : les paiements survivent à la suppression du compte (pièce comptable) ; `abonnements` en CASCADE. Aucune purge en S10 (durée légale : Q11). |
| 130 | Seed | `dr-cabrel` **reste gratuit** (e2e du badge). Deux comptes de la même persona : `dr-cabrel-payant` (actif, `expire_le` = maintenant + 45 j) et `dr-cabrel-grace` (`expire_le` = maintenant − 3 j), chacun avec 5 services pour montrer le masquage. |
| 131 | Hors S10 | Remboursement (`refund.*` journalisés `ignore`), virement (`payout.*` ignorés), carte, factures. |
| 132 | Interface | Carte Abonnement dans Compte, page `/tarifs` SSR, un seul message de limite, bandeau de grâce prioritaire sur la prochaine étape, aucune fenêtre promotionnelle. Les choix de période et de moyen sont des **boutons radio** (choix exclusif ; aucun réglage oui/non, donc ni case à cocher ni Switch). Vocabulaire CLAUDE.md §2. |
| 133 | Disponibilité du paiement | `paiementDisponible` ⇔ au moins un moyen actif dont le fournisseur est configuré, **et** des prix dans sa devise. Calculé côté serveur, exposé dans le DTO ; aucun drapeau public à part. |
| 134 | Pas de nouvelle bibliothèque | `fetch` natif + `AbortSignal.timeout`, `node:crypto` (HMAC, HKDF, `timingSafeEqual`), `node:http` pour le faux serveur. CLAUDE.md §8 inchangé. |

---

## 2. Migration `0021_s10_abonnements.sql`

Écrite à la main, avec `meta/0021_snapshot.json` et une entrée dans `meta/_journal.json`.

```sql
-- S10 (docs/specs/S10-abonnements.md §2). Abonnements, paiements, journal des événements de paiement.
CREATE TABLE "paiements" (
  "id" text PRIMARY KEY NOT NULL,                      -- = externalId envoyé au fournisseur
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
  CONSTRAINT "paiements_fournisseur_check" CHECK ("fournisseur" ~ '^[a-z0-9_-]{1,40}$'),
  CONSTRAINT "paiements_methode_check" CHECK ("methode" ~ '^[a-z_]{1,30}$'),
  CONSTRAINT "paiements_operateur_check" CHECK ("operateur" IS NULL OR "operateur" ~ '^[A-Z0-9_]{2,40}$'),
  CONSTRAINT "paiements_environnement_check" CHECK ("environnement" IN ('test','live')),
  CONSTRAINT "paiements_statut_check" CHECK ("statut" IN ('cree','en_attente','reussi','echoue','annule','expire','anomalie')),
  CONSTRAINT "paiements_plan_check" CHECK ("plan" ~ '^[a-z_]{1,30}$' AND "plan" <> 'gratuit'),
  CONSTRAINT "paiements_periode_check" CHECK ("periode_mois" BETWEEN 1 AND 36),
  CONSTRAINT "paiements_devise_check" CHECK ("devise" ~ '^[A-Z]{3}$'),
  CONSTRAINT "paiements_montants_check" CHECK (
    "montant_plan" > 0 AND "montant" >= "montant_plan" AND "montant" <= 1000000000
    AND "frais_estimes" >= 0 AND "net_estime" = "montant" - "frais_estimes"
    AND ("frais_reels" IS NULL OR "frais_reels" >= 0) AND ("net_reel" IS NULL OR "net_reel" >= 0)),
  CONSTRAINT "paiements_frais_taux_check" CHECK ("frais_taux_pb" BETWEEN 0 AND 5000),
  CONSTRAINT "paiements_frais_supporteur_check" CHECK ("frais_supporteur" IN ('marchand','client')),
  CONSTRAINT "paiements_telephone_masque_check" CHECK ("telephone_masque" IS NULL
    OR (char_length("telephone_masque") <= 32 AND position('•' in "telephone_masque") > 0)),
  CONSTRAINT "paiements_telephone_empreinte_check" CHECK ("telephone_empreinte" IS NULL OR "telephone_empreinte" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "paiements_code_echec_check" CHECK ("code_echec" IS NULL OR "code_echec" ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT "paiements_ids_check" CHECK (("id_fournisseur" IS NULL OR char_length("id_fournisseur") BETWEEN 1 AND 100)
    AND ("reference_fournisseur" IS NULL OR char_length("reference_fournisseur") BETWEEN 1 AND 100)),
  CONSTRAINT "paiements_applique_check" CHECK (("statut" = 'reussi') = ("applique_le" IS NOT NULL)),
  CONSTRAINT "paiements_terminal_check" CHECK (("statut" IN ('cree','en_attente')) = ("termine_le" IS NULL)),
  CONSTRAINT "paiements_attente_id_check" CHECK ("statut" <> 'en_attente' OR "id_fournisseur" IS NOT NULL OR "initiation_incertaine"),
  CONSTRAINT "paiements_verifications_check" CHECK ("verifications" BETWEEN 0 AND 1000)
);--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "paiements_fournisseur_id_unique" ON "paiements" ("fournisseur","id_fournisseur") WHERE "id_fournisseur" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "paiements_fournisseur_reference_unique" ON "paiements" ("fournisseur","reference_fournisseur") WHERE "reference_fournisseur" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "paiements_user_created_idx" ON "paiements" ("user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "paiements_ouverts_idx" ON "paiements" ("user_id") WHERE "statut" IN ('cree','en_attente');--> statement-breakpoint
CREATE INDEX "paiements_a_verifier_idx" ON "paiements" ("prochaine_verification") WHERE "statut" IN ('cree','en_attente');--> statement-breakpoint
CREATE INDEX "paiements_telephone_idx" ON "paiements" ("telephone_empreinte","created_at") WHERE "telephone_empreinte" IS NOT NULL;--> statement-breakpoint

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
  CONSTRAINT "abonnements_plan_check" CHECK ("plan" ~ '^[a-z_]{1,30}$' AND "plan" <> 'gratuit'),
  CONSTRAINT "abonnements_dates_check" CHECK ("premiere_activation_le" < "expire_le")
);--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_dernier_paiement_id_paiements_id_fk"
  FOREIGN KEY ("dernier_paiement_id") REFERENCES "paiements"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "abonnements_expire_le_idx" ON "abonnements" ("expire_le");--> statement-breakpoint
CREATE INDEX "abonnements_dernier_paiement_idx" ON "abonnements" ("dernier_paiement_id");--> statement-breakpoint

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
  CONSTRAINT "evenements_paiement_fournisseur_check" CHECK ("fournisseur" ~ '^[a-z0-9_-]{1,40}$'),
  CONSTRAINT "evenements_paiement_evenement_check" CHECK ("evenement" ~ '^[a-z_]{1,20}\.[a-z_]{1,20}$'),
  CONSTRAINT "evenements_paiement_source_check" CHECK ("source" IN ('webhook','interrogation')),
  CONSTRAINT "evenements_paiement_ids_check" CHECK (char_length("id_transaction") BETWEEN 1 AND 100
    AND ("external_id" IS NULL OR char_length("external_id") <= 100)),
  CONSTRAINT "evenements_paiement_statut_check" CHECK ("statut_fournisseur" IS NULL OR "statut_fournisseur" ~ '^[A-Z_]{1,30}$'),
  CONSTRAINT "evenements_paiement_traitement_check" CHECK ("traitement" IN ('applique','ignore','anomalie')),
  CONSTRAINT "evenements_paiement_motif_check" CHECK ("motif" IS NULL OR "motif" ~ '^[A-Z0-9_]{1,64}$')
);--> statement-breakpoint
ALTER TABLE "evenements_paiement" ADD CONSTRAINT "evenements_paiement_paiement_id_paiements_id_fk"
  FOREIGN KEY ("paiement_id") REFERENCES "paiements"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_paiement_dedup_unique" ON "evenements_paiement" ("fournisseur","id_transaction","evenement");--> statement-breakpoint
CREATE INDEX "evenements_paiement_paiement_idx" ON "evenements_paiement" ("paiement_id");--> statement-breakpoint

-- Outbox : rappels d'abonnement et reçu de paiement.
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("type" IN (
  'reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee',
  'reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle',
  'demande_visiteur_recue','message_professionnel_nouvelle',
  'reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee',
  'abonnement_rappel','paiement_confirme'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check"
  CHECK ("entite_type" IN ('reservation','demande','message','utilisateur','abonnement','paiement'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (
  ("entite_type" = 'reservation' AND "type" LIKE 'reservation_%')
  OR ("entite_type" = 'demande' AND "type" LIKE 'demande_%')
  OR ("entite_type" = 'message' AND "type" LIKE 'message_%')
  OR ("entite_type" = 'utilisateur' AND "type" LIKE 'utilisateur_%')
  OR ("entite_type" = 'abonnement' AND "type" LIKE 'abonnement_%')
  OR ("entite_type" = 'paiement' AND "type" LIKE 'paiement_%'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_occurrence_requise_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_requise_check"
  CHECK ("type" NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel')
         OR "occurrence" <> '');--> statement-breakpoint

-- IA : repli quand le quota du plan est atteint (onboarding).
ALTER TABLE "generations_ia" DROP CONSTRAINT "generations_ia_motif_check";--> statement-breakpoint
ALTER TABLE "generations_ia" ADD CONSTRAINT "generations_ia_motif_check" CHECK ("motif_repli" IS NULL OR "motif_repli" IN (
  'echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur',
  'sans_prompt','file_indisponible','limiteur_indisponible','plafond_global','quota_atteint'));

-- ROLLBACK (manuel, dans l'ordre ; à refuser si des paiements live existent : pièces comptables) :
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM paiements WHERE environnement = 'live') THEN RAISE EXCEPTION 'paiements live présents : rollback interdit'; END IF; END $$;
-- UPDATE generations_ia SET motif_repli = 'plafond_global' WHERE motif_repli = 'quota_atteint';
-- Recréer generations_ia_motif_check avec la liste 0018 (sans 'quota_atteint') ;
-- DELETE FROM emails_transactionnels WHERE entite_type IN ('abonnement','paiement');
-- Recréer les 4 CHECK de l'outbox (type, entite_type, entite_coherence, occurrence_requise) avec leurs listes 0020 ;
-- DROP TABLE evenements_paiement; DROP TABLE abonnements; DROP TABLE paiements;
-- DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash 0021>';
```

Notes :
- `paiements` est créé avant `abonnements` à cause de la FK `dernier_paiement_id`.
- Drizzle (`shared/db/schema.ts`) : `paiements`, `abonnements`, `evenementsPaiement`, plus les CHECK et index ci-dessus. Commentaire « listes recopiées depuis `shared/paiements.ts` et `shared/plans.ts` : garder synchronisés ».
- Aucune table existante ne reçoit de colonne : migration non bloquante (seuls les CHECK de l'outbox et des générations IA sont recréés, validation sur des tables petites).

---

## 3. Contrats `shared/`

### 3.1 `shared/plans.ts` (nouveau, pur : identifiants et textes, **aucun prix ni limite chiffrée**)

```ts
export const PLAN_IDS = ['gratuit', 'payant'] as const
export type PlanId = (typeof PLAN_IDS)[number]
export const ETATS_ABONNEMENT = ['gratuit', 'actif', 'grace'] as const
export type EtatAbonnement = (typeof ETATS_ABONNEMENT)[number]
export const RESSOURCES_QUOTA = ['services', 'realisations', 'temoignages', 'reservations_mois', 'generations_ia_mois'] as const
export type RessourceQuota = (typeof RESSOURCES_QUOTA)[number]
export const RESSOURCES_MASQUABLES = ['services', 'realisations', 'temoignages'] as const
export const PERIODES_MOIS = [1, 3, 12] as const
export type PeriodeMois = (typeof PERIODES_MOIS)[number]
export const PERIODE_MISE_EN_AVANT: PeriodeMois = 12
export const ABONNEMENT_GRACE_JOURS = 7
export const ABONNEMENT_RAPPELS_JOURS = [7, 3, 0] as const
export const ABONNEMENT_RAPPEL_HEURE_LOCALE = 9
export const ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES = 6
export const ABONNEMENT_FUSEAU_REPLI = 'Africa/Douala'
export const ABONNEMENT_CHEMIN = '/studio/compte#abonnement'
/** Textes de déblocage ({limite} interpolé depuis la configuration). */
export const LIMITE_MESSAGES: Record<RessourceQuota, { titre: string, texte: string }>
// services : « Vous avez atteint {limite} services, la limite du plan gratuit. » / « Avec le plan payant, ajoutez autant de services que vous le souhaitez, et le badge Brandself disparaît de votre vitrine. »
// réalisations, témoignages : même modèle. reservations_mois : « Vous avez reçu {limite} réservations ce mois-ci… les visiteurs ne peuvent plus réserver avant le {date}. » ; generations_ia_mois : « Vous avez utilisé vos {limite} propositions de l'IA ce mois-ci… »
export const LIMITE_ACTION = { libelle: 'Voir l’abonnement', chemin: ABONNEMENT_CHEMIN } as const
```

### 3.2 `shared/paiements.ts` (nouveau, pur)

```ts
export const FOURNISSEURS_PAIEMENT = ['kpay'] as const
export type FournisseurPaiement = (typeof FOURNISSEURS_PAIEMENT)[number]
export const FOURNISSEUR_FORMAT = /^[a-z0-9_-]{1,40}$/
export const METHODES_PAIEMENT = ['mobile_money', 'carte'] as const
export type MethodePaiement = (typeof METHODES_PAIEMENT)[number]
export const PAIEMENT_STATUTS = ['cree','en_attente','reussi','echoue','annule','expire','anomalie'] as const
export type PaiementStatut = (typeof PAIEMENT_STATUTS)[number]
export const PAIEMENT_STATUTS_OUVERTS = ['cree','en_attente'] as const
export const FRAIS_SUPPORTEURS = ['marchand','client'] as const
export type FraisSupporteur = (typeof FRAIS_SUPPORTEURS)[number]
export const POINTS_BASE_TOTAL = 10_000
export const DEVISES_EXPOSANT: Record<string, number> = { XAF: 0, XOF: 0, EUR: 2, USD: 2 }
export const EVENEMENTS_NORMALISES = ['payment.completed','payment.failed','payment.cancelled'] as const
export const TRAITEMENTS_EVENEMENT = ['applique','ignore','anomalie'] as const
export const CODES_ANOMALIE = ['MONTANT_INCOHERENT','ID_INCOHERENT','DEVISE_INCOHERENTE','PAIEMENT_INCONNU','REMBOURSE','EVENEMENT_NON_GERE'] as const
/** Messages au payeur par code d'échec fournisseur (repli : DEFAUT). */
export const MESSAGES_ECHEC: Record<string, string>
// PAYER_NOT_FOUND « Ce numéro n’a pas de compte Mobile Money chez cet opérateur. Vérifiez le numéro et l’opérateur. »
// PAYMENT_NOT_APPROVED « Le paiement n’a pas été validé sur votre téléphone. Vous pouvez réessayer. »
// PAYER_LIMIT_REACHED « Le plafond de ce compte Mobile Money est atteint. Réessayez plus tard ou avec un autre numéro. »
// INSUFFICIENT_BALANCE « Le solde de ce compte est insuffisant. »
// TRANSACTION_ALREADY_IN_PROCESS « Un paiement est déjà en cours sur ce numéro. Patientez quelques minutes. »
// EXPIRE « Nous n’avons pas reçu la validation à temps. Si un montant a été prélevé, votre abonnement sera activé automatiquement. »
// DEFAUT « Le paiement n’a pas abouti. Vous pouvez réessayer. »
export const PAIEMENT_SUIVI_INTERVALLE_MS = 5_000
export const PAIEMENT_SUIVI_MAX_MS = 180_000
export const PAIEMENT_RELANCE_APRES_S = 60
export const TELEPHONE_MASQUE_CHIFFRES_VISIBLES = 2
export const TELEPHONE_MASQUE_CARACTERE = '•'
```

### 3.3 Configuration serveur (non importable par `app/`)

- `server/config/plans.ts` : `ConfigPlan { services, realisations, temoignages, reservationsParMois, generationsIaParMois: number | null, badge: boolean, statistiquesJours: number }`. Valeurs : gratuit `{3, 3, 3, 10, 3, true, 7}` ; payant `{null × 5, false, 90}`. Plus `PRIX_STATUT: 'a_valider' | 'valide'`, `PRIX_PLANS: Record<'payant', Record<Devise, Record<PeriodeMois, number>>>` (§1 #106), `PLAN_PAYANT_ID = 'payant'`. Le type `IaPlan` (S8) devient un alias de `PlanId`.
- `server/config/paiements.ts` :
  - `MOYENS_PAIEMENT: MoyenPaiementConfig[]`, avec `{ id: 'kpay:MTN_MOMO_CMR', fournisseur, methode, operateur, libelle: 'MTN MoMo', pays: 'CMR', indicatif: '237', devise: 'XAF', montantMin: 100, numeroNational: /^6\d{8}$/, actif: true }` et `ORANGE_CMR` (« Orange Money ») actif ; les autres sont inactifs ;
  - `FRAIS_PAIEMENT` (#107) ;
  - `assertConfigPaiements(env)` : prix entiers ≥ `montantMin`, exposant 0 pour toute devise d'un moyen K-PAY actif (l'adaptateur refuse les devises à décimales), `PRIX_STATUT` en production. Appelée au démarrage du serveur (plugin Nitro) et du worker.

### 3.4 Constantes K-PAY et limites

`server/services/paiements/fournisseurs/kpay/constantes.ts` :
- `KPAY_BASE_URL_DEFAUT`
- `KPAY_CHEMIN_INIT = '/api/v1/payments/init'`
- `KPAY_CHEMIN_TRANSACTION = '/api/v1/payments/'`
- `KPAY_DELAI_INITIATION_MS = 10_000`, `KPAY_DELAI_CONSULTATION_MS = 8_000`
- `KPAY_ENTETE_SIGNATURE = 'x-kpay-signature'`
- `KPAY_STATUTS_NON_TERMINAUX = ['PENDING','PROCESSING','SUBMITTED']`
- `KPAY_DESCRIPTION = 'Brandself — abonnement {n} mois'`

`shared/limites.ts` :
- `PAIEMENT_INIT_LIMIT_UTILISATEUR`, `PAIEMENT_INIT_LIMIT_NUMERO`, `PAIEMENT_SUIVI_LIMIT`, `KPAY_APPELS_MAX_PAR_MINUTE`
- `PAIEMENTS_OUVERTS_MAX`, `WEBHOOK_CORPS_MAX_OCTETS`

`shared/jobs.ts` :
- `FILE_PAIEMENTS = 'paiements'`, `PAIEMENTS_CONCURRENCE_WORKER = 1`
- `JOBS.verifierPaiements = 'paiements-verifier'`, `PAIEMENTS_SCHEDULER_ID`, `PAIEMENTS_TICK_MS`
- `PAIEMENTS_VERIFICATION_LOT`, `PAIEMENTS_VERIFICATION_CALENDRIER_S`, `PAIEMENT_EXPIRATION_MINUTES`
- `TRANSACTIONAL_EMAIL_TYPES` reçoit `'abonnement_rappel'` et `'paiement_confirme'`.

`shared/notifications.ts` : `CODES_ANNULATION` reçoit `'ABONNEMENT_RENOUVELE'` et `'PAIEMENT_NON_REUSSI'`.

`shared/ia.ts` : `MOTIFS_REPLI` et `MOTIFS_REPLI_TRANSITOIRES` reçoivent `'quota_atteint'` ; `IA_PLANS` est remplacé par `PlanId`.

### 3.5 Schémas Zod

`shared/schemas/abonnement.ts` :

```ts
export const schemaPaiementInitier = z.strictObject({
  periodeMois: z.union(PERIODES_MOIS.map((p) => z.literal(p))),
  devise: z.string().regex(/^[A-Z]{3}$/),
  moyen: z.string().regex(/^[a-z0-9_-]{1,40}:[A-Z0-9_]{2,40}$/),
  telephone: z.string().trim().min(8).max(20).regex(/^\+?[0-9 ]+$/),
})
export const schemaPaiementId = z.strictObject({ id: z.uuid() })
export const schemaTarifsQuery = z.strictObject({ devise: z.string().regex(/^[A-Z]{3}$/).optional() })
export const schemaWebhookFournisseur = z.strictObject({ fournisseur: z.string().regex(FOURNISSEUR_FORMAT) })
```

`server/services/paiements/fournisseurs/kpay/schemas.ts` : objets **tolérants** (`z.looseObject`, champs inconnus ignorés, jamais réémis) :

```ts
initReponse = { id: z.string().min(1).max(100), reference: z.string().min(1).max(100).optional(),
  status: z.string().max(30), amount: z.number(), currency: z.string().length(3).optional(), externalId: z.string().max(100) }
transaction = { id, reference?, status, amount, netAmount?: z.number().nonnegative(), feeAmount?: z.number().nonnegative(),
  currency?, externalId?, failureReason?: z.string().max(64).nullable() }   // phoneNumber volontairement non lu
webhook = { event: z.string().max(40), paymentId: z.string().min(1).max(100), reference?: z.string().max(100),
  status: z.string().max(30), amount: z.number().nonnegative(), externalId?: z.string().max(100),
  currency?: z.string().length(3), timestamp?: z.string().max(40) }
```

Montants : la valeur K-PAY doit être un entier (`Number.isSafeInteger`) en devise d'exposant 0, sinon `anomalie`/`MONTANT_INCOHERENT`.

### 3.6 DTO (`shared/dto/abonnement.ts`, réexport dans `shared/dto/index.ts`)

```ts
interface QuotaDTO { ressource: RessourceQuota, utilise: number, limite: number | null }
interface PrixPeriodeDTO { periodeMois: PeriodeMois, montant: number, montantParMois: number, remisePct: number, miseEnAvant: boolean }
interface DeviseOffreDTO { devise: string, exposant: number, prix: PrixPeriodeDTO[] }
interface MoyenPaiementDTO { id: string, libelle: string, methode: MethodePaiement, devise: string, indicatif: string, exemple: string }
interface OffreDTO { paiementDisponible: boolean, devises: DeviseOffreDTO[], deviseParDefaut: string | null, moyens: MoyenPaiementDTO[] }
interface PaiementDTO { id: string, statut: PaiementStatut, periodeMois: number, montant: number, devise: string,
  moyenLibelle: string, telephoneMasque: string | null, messageEchec: string | null, creeLe: string,
  termineLe: string | null, relanceDisponibleLe: string, abonnementExpireLe: string | null }
interface AbonnementDTO { plan: PlanId, etat: EtatAbonnement, expireLe: string | null, dernierJourInclus: string | null,
  graceJusquau: string | null, joursRestants: number | null, renouvellementAutomatique: false,
  quotas: QuotaDTO[], paiementEnCours: PaiementDTO | null, offre: OffreDTO }
interface PlanTarifDTO { id: PlanId, limites: Record<RessourceQuota, number | null>, badge: boolean, statistiquesJours: number }
interface TarifsDTO { plans: PlanTarifDTO[], offre: OffreDTO, graceJours: number, renouvellementAutomatique: false }
```

Champs ajoutés aux DTO existants :
- `VitrinePubliqueDTO.badgeBrandself: boolean` ;
- compteurs studio des services, réalisations et témoignages : `limitePlan: { limite: number | null, utilise: number, atteinte: boolean }` ;
- éléments des listes studio : `masqueParPlan: boolean` ;
- réponse des créneaux publics : `suspendues: boolean`.

Aucune donnée du compte K-PAY, aucun `id_fournisseur`, aucune empreinte n'apparaît dans un DTO.

### 3.7 Erreurs (`shared/erreurs.ts` + `ERROR_MESSAGES`)

| Code | HTTP | Message (vouvoiement) |
|---|---|---|
| `LIMITE_PLAN_ATTEINTE` | 403 | « Vous avez atteint la limite du plan gratuit. » (le détail vient de `LIMITE_MESSAGES`) |
| `RESERVATIONS_INDISPONIBLES` | 409 | §1 #125 |
| `PAIEMENT_INDISPONIBLE` | 503 | « Le paiement en ligne n’est pas disponible pour le moment. » |
| `FOURNISSEUR_INDISPONIBLE` | 503 (+ `retryAfter`) | « L’opérateur ne répond pas. Réessayez dans un instant. » |
| `MOYEN_PAIEMENT_INVALIDE` | 422 | « Ce moyen de paiement n’est pas disponible. » |
| `DEVISE_NON_PAYABLE` | 422 | « Cette devise n’est pas encore acceptée. » |
| `TELEPHONE_INVALIDE` | 422 | « Ce numéro ne correspond pas à l’opérateur choisi. » |
| `PAIEMENT_EN_COURS` | 409 (+ `paiementId`) | « Un paiement est déjà en cours. Validez-le sur votre téléphone. » |
| `PAIEMENT_REFUSE` | 422 | « L’opérateur a refusé la demande. Vérifiez le numéro. » |
| `PAIEMENT_INTROUVABLE` | 404 | « Ce paiement est introuvable. » |
| `SIGNATURE_INVALIDE` | 401 | (corps minimal) |
| `FOURNISSEUR_INCONNU` | 404 | |
| `WEBHOOK_NON_CONFIGURE` | 503 | |
| `CORPS_TROP_GROS` | 413 | |
| `CORPS_ILLISIBLE` | 400 | |

### 3.8 `shared/env.ts`

Variables §1 #118, `superRefine` de production, fonction exportée `resolveKpayEnvironnement(cle): 'test' | 'live'`. Les messages d'erreur ne répètent jamais une valeur. `KPAY_BASE_URL` est validée comme `IA_BASE_URL` (sans identifiants ; hôtes HTTP autorisés `KPAY_HOTES_HTTP_AUTORISES = ['127.0.0.1','localhost']` hors production).

---

## 4. Routes API

Toutes passent par `defineApiHandler` : Zod, service, ressource. Aucune logique dans la route.

| Méthode | Fichier | Entrée | Succès | Erreurs |
|---|---|---|---|---|
| GET | `server/api/studio/abonnement/index.get.ts` | — | 200 `AbonnementDTO` | 401 |
| POST | `server/api/studio/abonnement/paiements/index.post.ts` | `schemaPaiementInitier` | 201 `{ paiement: PaiementDTO }` (statut `en_attente`, ou `echoue` si l'opérateur a refusé l'initiation : alors 422 `PAIEMENT_REFUSE`) | 401, 409 `PAIEMENT_EN_COURS`, 422 (VALIDATION, MOYEN, DEVISE, TELEPHONE), 429, 503 |
| GET | `server/api/studio/abonnement/paiements/[id].get.ts` | `schemaPaiementId` | 200 `{ paiement: PaiementDTO }` | 401, 404 (y compris le paiement d'autrui), 429 |
| GET | `server/api/public/tarifs/index.get.ts` | `?devise=` | 200 `TarifsDTO` ; `Cache-Control: public, max-age=300` | 422 |
| POST | `server/api/webhooks/[fournisseur].post.ts` | corps brut + en-tête de signature | 200 `{ recu: true }` | 401, 404, 413, 400, 503 ; 500 si la base est en panne (K-PAY réessaie) |

Routes existantes dont la réponse change (vérifier les consommateurs) :
- `GET /api/public/:username` : `badgeBrandself`, contenus plafonnés ;
- listes et détails publics des services, réalisations et témoignages : masquage ;
- `creneaux` : `suspendues` ;
- `POST` réservations : 409 `RESERVATIONS_INDISPONIBLES`, et 404 si le service est masqué ;
- `POST` demandes : 404 si le service est masqué ;
- `POST` de création studio des services, réalisations et témoignages : 403 ;
- listes studio : `limitePlan`, `masqueParPlan` ;
- `POST /api/studio/ia/ameliorer` : 403 ;
- `POST /api/studio/onboarding/generer` : repli `quota_atteint`.

Le webhook n'est pas une route studio : aucune session, aucun middleware d'authentification. Lot B2 à vérifier : aucun middleware global ne lit le corps. Nginx : `client_max_body_size 16k`, pas de cache, journal sans corps (§9).

---

## 5. Architecture des fichiers

### 5.1 PlanService et masquage (lot B1)

- `server/services/plans.ts` (réécrit) :
  - `resoudrePlanEffectif(abonnement | null, now)` (pur) → `{ plan, etat, expireLe, graceJusquau, joursRestants, dernierJourInclus }` ;
  - `getPlanEffectif(userId, now, executor = db)` ;
  - `limiteDe(plan, ressource)` ;
  - `assertQuota(tx, { userId, vitrineId, fuseau }, ressource, now)` : verrou (#124), comptage, `LimiteAtteinteError` ;
  - `getQuotas(userId, now)` ;
  - `getIaQuota` (compat S8, comptage actives+terminées).
- `server/services/plans-regles.ts` (pur) : `debutMoisLocal`, `appliquerPlafondPublic(items, limite)`, `construireErreurLimite`.
- `server/services/plan-visibilite.ts` : `sqlIdsVisibles(table, vitrineId, limite)` (sous-requête `row_number() OVER (ORDER BY created_at, id)` parmi les `actif`, filtre `rn <= limite` si la limite n'est pas nulle) ; `getPlanPublic(vitrine)` → `{ plan, limites, badge }` (une requête sur `abonnements`, mémorisée par requête).
- Branchements :
  - `services.ts` (`insertService`, `listVisible`, `getPublicService*`) ;
  - `realisations.ts`, `temoignages.ts` (création + lecture publique) ;
  - `vitrines.ts` (`getPublicVitrinePage` : compteurs et drapeau agenda sur les ids visibles ; `badgeBrandself`) ;
  - `creneaux.ts` (`requirePublicAgendaService` : service masqué → 404 ; `suspendues`) ;
  - `reservations.ts` (`createReservation` : `assertQuota('reservations_mois')` dans la transaction, traduit en 409 pour le visiteur) ;
  - création des demandes (service masqué → 404) ;
  - `ia/generations.ts` ;
  - `onboarding.ts` (`terminer` tronqué) ;
  - ressources `vitrine.ts`, `service.ts`, `realisation.ts`, `temoignage.ts`.

### 5.2 Paiements (lot B2)

```ts
// server/services/paiements/types.ts
export interface InitiationRequete {
  externalId: string, montant: number, devise: string, operateur: string,
  telephoneInternational: string, description: string
}
export type InitiationResultat =
  | { issue: 'accepte', idFournisseur: string, referenceFournisseur: string | null, statutFournisseur: string }
  | { issue: 'refuse', code: string }            // 400 du fournisseur
  | { issue: 'incertain', code: 'DELAI' | 'DOUBLON' | 'RESEAU' }
  | { issue: 'indisponible', code: 'AUTH' | 'LIMITE' | 'SERVEUR', retryAfterS?: number }
export interface EtatFournisseur {
  idFournisseur: string, statut: 'en_attente' | 'reussi' | 'echoue' | 'annule' | 'rembourse',
  montant: number, devise: string | null, fraisReels: number | null, netReel: number | null,
  codeEchec: string | null, referenceFournisseur: string | null
}
export interface EvenementNormalise {
  evenement: string, idTransaction: string, externalId: string | null,
  statut: EtatFournisseur['statut'] | 'autre', montant: number, devise: string | null,
  referenceFournisseur: string | null, horodatage: Date | null, codeEchec: string | null
}
export interface PaiementProvider {
  readonly nom: FournisseurPaiement
  readonly environnement: 'test' | 'live'
  initier(req: InitiationRequete, signal: AbortSignal): Promise<InitiationResultat>
  consulter(idFournisseur: string, signal: AbortSignal): Promise<EtatFournisseur | null>   // null = 404
  verifierSignature(corpsBrut: Buffer, entetes: Readonly<Record<string, string | undefined>>): boolean
  interpreterWebhook(corps: unknown): EvenementNormalise | null                           // null = schéma invalide
}
```

Fichiers :
- `server/services/paiements/montants.ts` (pur) : `calculerMontants({ prixPlan, tauxPb, supporteur })`, `ceilDiv`, `prixPeriodes` (remises).
- `server/services/paiements/telephone.ts` (pur sauf la clé HMAC) : `normaliserNumero(saisie, moyen)`, `masquer`, `empreinte`.
- `server/services/paiements/transitions.ts` (pur).
- `server/services/paiements/fournisseurs/index.ts` : `getPaiementProvider(nom)`, `fournisseursConfigures()`.
- `server/services/paiements/fournisseurs/kpay/{constantes,schemas,client,signature,adaptateur}.ts` :
  - le client fait un `fetch` avec les en-têtes `X-API-Key`, `X-Secret-Key`, `Content-Type: application/json`, le corps `{ amount, provider, phoneNumber, externalId, currency, description }`, sans `customerEmail` ni `metadata` ;
  - la signature : HMAC-SHA256 hex du `Buffer` brut ; en-tête `^[0-9a-fA-F]{64}$`, sinon faux ; `timingSafeEqual` sur les 32 octets décodés.
- `server/services/abonnements.ts` :
  - `getAbonnementView(userId, now)` ;
  - `initierPaiement(userId, input, now, deps)` ;
  - `getOwnPaiement(userId, id)` ;
  - `appliquerEvenement(fournisseur, evt, source, now)` : transaction, journal, `FOR UPDATE`, contrôles, transition, prolongation, outbox `paiement_confirme` ;
  - `verifierPaiementsDus(now, deps)` ;
  - `prolonger(tx, userId, periodeMois, now)`.
- `server/services/abonnements-regles.ts` (pur) : `calculerNouvelleEcheance(base, mois, fuseau)`, `minuitLocalSuivant`.
- `server/services/webhooks-paiement.ts` : `recevoirWebhook(fournisseur, corpsBrut, entetes, now)`, qui orchestre signature → interprétation → `appliquerEvenement`.
- `server/resources/abonnement.ts`, `server/jobs/paiements.ts` (`planifierVerificationsPaiements(queue)`), `worker/index.ts` (worker `paiements`), `server/db/seed.ts` (#130).

### 5.3 Rappels (lot B3)

- `server/services/notifications/abonnements.ts` : `planifierRappelsAbonnement(now, tx)` (fenêtres locales, réutilise `fenetres.ts`), appelée par `planification.ts`.
- `pertinence.ts` : règles des 2 nouveaux types.
- `email-outbox.ts` : chargeurs `abonnement` et `paiement`.
- `emails/contenus.ts` et `notifications-contenus.ts` : 3 rappels + reçu (texte seul, pied « Vous recevez… », dates `fr-FR` dans `users.fuseau`, montant formaté selon l'exposant, numéro masqué seulement).

---

## 6. Critères d'acceptation

**[PG]** = contre le vrai PostgreSQL (et Redis si cité), **interdit de mocker la couche prouvée**. **[U]** = unitaire pur. **[E2E]** = Playwright. L'horloge est injectée. Fuseau `Africa/Douala` (UTC+1) sauf mention.

### Base
- **CA01 [PG]** Given 0021 appliquée, When on insère un paiement `telephone_masque = '237653456789'`, Then la base refuse (`telephone_masque_check`).
- **CA02 [PG]** Given un paiement `statut='reussi'` sans `applique_le`, When on insère, Then refus (`applique_check`). Given `net_estime ≠ montant − frais_estimes`, Then refus.
- **CA03 [PG]** Given deux événements `(kpay, tx1, payment.completed)`, When le second est inséré, Then violation d'unicité.
- **CA04 [PG]** Given un utilisateur avec abonnement et 2 paiements, When il est supprimé, Then l'abonnement disparaît, les paiements restent avec `user_id NULL` et les événements restent liés.
- **CA05 [PG]** Given `fournisseur='KPay!'` ou `methode='Carte'`, When on insère, Then refus ; Given `fournisseur='stripe'`, `methode='carte'`, Then accepté (aucune migration pour un nouveau fournisseur).
- **CA06 [PG]** Given l'outbox, When on insère `abonnement_rappel` avec `occurrence=''`, Then refus ; avec `entite_type='paiement'`, Then refus (cohérence).
- **CA07 [PG]** Given 0021, ROLLBACK, puis 0021 rejouée, When on lance les suites d'intégration S8 et S9, Then elles sont vertes ; Given un paiement `live`, Then le ROLLBACK s'interrompt.
- **CA08 [PG]** Given `generations_ia.motif_repli='quota_atteint'`, Then accepté.

### Configuration, montants, clés
- **CA09 [U]** `calculerMontants({ prixPlan: 5000, tauxPb: 500, supporteur: 'marchand' })` = `{ montant: 5000, frais: 250, net: 4750 }` ; 4999 → frais 250, net 4749 (arrondi supérieur) ; 13500 → 675 / 12825 ; 48000 → 2400 / 45600.
- **CA10 [U]** `supporteur: 'client'`, 5000 @ 500 → `{ montant: 5264, frais: 264, net: 5000 }` ; invariant pour tout prix de 100 à 10⁷ : `net ≥ prixPlan` et `montant − frais = net` (test de propriété sur un échantillon).
- **CA11 [U]** Taux 0 → frais 0 ; taux > 5000 ou valeur non entière → `assertConfigPaiements` lève.
- **CA12 [PG]** Given un paiement créé avec 500 pb, When la configuration passe à 600 pb, Then la ligne garde `frais_taux_pb = 500` et ses montants (snapshot).
- **CA13 [U]** `prixPeriodes` XAF : remise 3 mois = 10 %, 12 mois = 20 %, `montantParMois` 12 mois = 4000, `miseEnAvant` seulement sur 12.
- **CA14 [U]** `loadEnv` : production + `kpay_test_…` sans `KPAY_MODE_TEST_AUTORISE` → erreur citant la variable mais pas la valeur ; production + clés sans `KPAY_WEBHOOK_SECRET` → erreur ; `KPAY_API_KEY` sans `KPAY_SECRET_KEY` → erreur ; `KPAY_BASE_URL=http://evil.com` → erreur ; `http://127.0.0.1:4010` hors production → accepté.
- **CA15 [U]** Production + `PRIX_STATUT='a_valider'` → `assertConfigPaiements` lève ; un prix sous `montantMin` ou une devise à décimales sur un moyen K-PAY actif → lève.
- **CA16 [U]** Offre sans clés → `paiementDisponible=false`, `devises=[]` ; avec clés → devises `['XAF']` seulement, EUR et USD absents ; moyens = MTN MoMo et Orange Money (Cameroun).

### Client K-PAY (faux serveur HTTP local, `node:http` sur 127.0.0.1)
- **CA17 [U+HTTP]** Given le faux serveur qui répond 201, When `initier`, Then la requête reçue a `POST /api/v1/payments/init`, les en-têtes `X-API-Key`, `X-Secret-Key` et `Content-Type: application/json`, et le corps exact `{ amount: 5000, provider: 'MTN_MOMO_CMR', phoneNumber: '237653456789', externalId: <uuid>, currency: 'XAF', description: 'Brandself — abonnement 1 mois' }`, sans `customerEmail` ni `metadata` ; résultat `accepte` avec `idFournisseur`.
- **CA18 [U+HTTP]** 400 → `refuse` ; 401 → `indisponible/AUTH` ; 409 → `incertain/DOUBLON` ; 429 avec `Retry-After: 30` → `indisponible/LIMITE`, `retryAfterS=30` ; 500 → `indisponible/SERVEUR`.
- **CA19 [U+HTTP]** Le serveur ne répond jamais → `incertain/DELAI` après au plus `KPAY_DELAI_INITIATION_MS` + 200 ms ; aucun nouvel essai (1 seule requête reçue).
- **CA20 [U+HTTP]** Réponse 201 en JSON invalide, ou sans `id` → `incertain/RESEAU` ; champs inconnus ignorés.
- **CA21 [U+HTTP]** `consulter` : 200 `COMPLETED` avec `feeAmount: 250`, `netAmount: 4750` → `{ statut: 'reussi', fraisReels: 250, netReel: 4750 }` ; `PROCESSING` → `en_attente` ; `FAILED` + `failureReason: 'PAYER_NOT_FOUND'` → `echoue`/`PAYER_NOT_FOUND` ; 404 → `null`.
- **CA22 [U]** Pendant CA17 à CA21, les journaux espionnés (`console.*`) ne contiennent ni `kpay_test_`, ni la clé secrète, ni `237653456789`, ni le corps de réponse.
- **CA23 [U]** `verifierSignature` : HMAC calculé indépendamment avec `node:crypto` sur le même `Buffer` → vrai ; un octet du corps modifié → faux ; en-tête absent, de 63 caractères, non hexadécimal, ou de 128 caractères → faux sans exception ; hexadécimal en majuscules valide → vrai. Le corps contenant des caractères UTF-8 multi-octets (`"é"`) est vérifié sur les octets bruts.
- **CA24 [U]** `interpreterWebhook` : `payment.completed` + `COMPLETED` → `statut: 'reussi'` ; `payout.completed` → `statut: 'autre'` ; schéma invalide (`amount: "5000"`) → `null`.
- **CA25 (optionnel, hors gate)** Projet Vitest `sandbox`, lancé seulement par `pnpm test:sandbox` avec `KPAY_SANDBOX=1` et les vraies clés de test : `237653456789` aboutit à `COMPLETED`, `237653456019` à `FAILED`/`PAYER_LIMIT_REACHED`, `237653456129` reste non terminal ; consultation toutes les 10 s, 2 min au plus. Ce projet n'est pas inclus dans `pnpm test` : il n'est **ni compté ni présenté comme vert ou sauté**. Sortie brute à coller séparément si l'essai est fait.
- **CA26 [U]** `normaliserNumero('653 456 789', CMR)` = `237653456789` ; `'+237653456789'` idem ; `'0653456789'`, `'553456789'` et `'2376534567890'` → `TELEPHONE_INVALIDE` ; `masquer('237653456789')` = `'+237 6•• ••• •89'`.

### Initiation
- **CA27 [PG+Redis+HTTP]** Given un utilisateur gratuit et le faux K-PAY en 201, When `POST /api/studio/abonnement/paiements { periodeMois: 12, devise: 'XAF', moyen: 'kpay:MTN_MOMO_CMR', telephone: '653456789' }`, Then 201, `paiement.statut='en_attente'`, `montant=48000`, `telephoneMasque='+237 6•• ••• •89'` ; en base : `id_fournisseur` renseigné, `montant_plan=48000`, `frais_estimes=2400`, `environnement='test'`, `prochaine_verification ≈ now+15 s`, `expire_avant = now+15 min`. **Aucune colonne ne contient `653456789`** (requête `SELECT row_to_json(p)::text LIKE '%653456789%'` → faux).
- **CA28 [PG]** Given le faux K-PAY qui vérifie que l'`externalId` reçu existe déjà en base avec `statut='cree'` au moment de l'appel, When initiation, Then c'est vrai (la ligne est committée avant l'appel).
- **CA29 [PG+HTTP]** 400 du fournisseur → 422 `PAIEMENT_REFUSE`, ligne `echoue`/`code_echec='REQUETE_REFUSEE'` ; délai dépassé → 201 `en_attente`, `initiation_incertaine=true`, `id_fournisseur NULL`.
- **CA30 [PG]** Moyen inactif (`kpay:ORANGE_CIV`) ou inconnu → 422 `MOYEN_PAIEMENT_INVALIDE` ; `devise:'EUR'` avec un moyen XAF → 422 `DEVISE_NON_PAYABLE` ; `periodeMois: 6` → 422 `VALIDATION` ; aucune ligne créée.
- **CA31 [PG]** Sans clés K-PAY → 503 `PAIEMENT_INDISPONIBLE`, aucune ligne.
- **CA32 [PG+Redis]** 4e initiation du même utilisateur alors que le paiement le plus récent a moins de 60 s → 409 `PAIEMENT_EN_COURS` avec son id ; après 60 s → 201 ; avec 2 paiements ouverts → 409.
- **CA33 [PG+Redis]** 4 initiations en 15 min vers le même numéro, depuis 2 comptes différents → la 4e reçoit 429 (limite par numéro, comptée sur l'empreinte) ; 6e initiation d'un même utilisateur → 429.
- **CA34 [PG+Redis]** Redis coupé → 503 `LIMITEUR_INDISPONIBLE`, aucun appel au fournisseur (fail-closed).
- **CA35 [Redis]** Compteur global `kpay:appels` à 60 dans la minute → 503 `FOURNISSEUR_INDISPONIBLE` avec `Retry-After`.
- **CA36 [PG]** `GET /api/studio/abonnement/paiements/:id` du paiement d'un autre utilisateur → 404 `PAIEMENT_INTROUVABLE` ; id non UUID → 422.
- **CA37 [PG]** Initiation `supporteur='client'` (configuration injectée) → K-PAY reçoit `amount: 5264` pour un prix de 5000.

### Webhook
- **CA38 [PG]** Given un paiement `en_attente` (1 mois, 5000, utilisateur gratuit, now 2026-11-03T13:00Z), When `POST /api/webhooks/kpay` avec un corps `payment.completed` (`amount: 5000`, `externalId` = id) correctement signé, Then 200 `{ recu: true }` ; paiement `reussi`, `applique_le` posé ; `abonnements.expire_le = 2026-12-03T23:00Z` ; un événement `applique` ; une ligne outbox `paiement_confirme`.
- **CA39 [PG]** Given CA38, When **le même corps est rejoué**, Then 200 identique, `expire_le` inchangé, 1 seul événement, 1 seule ligne outbox.
- **CA40 [PG]** Given CA38, When le même événement est envoyé **deux fois en parallèle** (`Promise.all`, deux connexions), Then deux 200, une seule prolongation (`expire_le = 2026-12-03T23:00Z`), un seul événement.
- **CA41 [PG]** Signature invalide, absente ou calculée sur un corps re-sérialisé → 401 `{ code: 'SIGNATURE_INVALIDE' }`, aucune ligne écrite (ni paiement ni événement), aucun détail sur la cause.
- **CA42 [PG]** `amount: 4000` pour un paiement de 5000 → 200, paiement `anomalie`/`MONTANT_INCOHERENT`, **aucun abonnement créé**, événement `anomalie`, journal d'alerte sans numéro ni corps.
- **CA43 [PG]** `externalId` inconnu → 200, événement `ignore`/`PAIEMENT_INCONNU`, rien d'autre.
- **CA44 [PG]** `payout.completed` ou `refund.completed` signés → 200, événement `ignore`/`EVENEMENT_NON_GERE`, paiement inchangé.
- **CA45 [PG]** `payment.failed` avec `failureReason` sur `en_attente` → `echoue` ; le DTO de suivi renvoie `messageEchec` = `MESSAGES_ECHEC[code]` ; aucune prolongation.
- **CA46 [PG]** Given un paiement `expire` (15 min dépassées), When un `payment.completed` signé arrive, Then `reussi` et prolongation appliquée (CA de non-perte d'argent).
- **CA47 [PG]** Given un paiement `reussi`, When `payment.failed` arrive, Then 200, statut inchangé, événement journalisé `ignore`.
- **CA48 [PG]** Corps de 16 385 octets → 413 avant vérification ; `Content-Length` absent et corps envoyé en morceaux au-delà de la limite → 413.
- **CA49 [PG]** Signature valide mais JSON illisible → 400 `CORPS_ILLISIBLE`, aucune écriture.
- **CA50 [PG]** `KPAY_WEBHOOK_SECRET` absent (dev) → 503 `WEBHOOK_NON_CONFIGURE`.
- **CA51 [PG]** `POST /api/webhooks/stripe` (fournisseur hors registre) → 404.
- **CA52 [PG]** `id_fournisseur` déjà connu `tx_A` et webhook `paymentId: 'tx_B'` pour le même `externalId` → `anomalie`/`ID_INCOHERENT`.

### Rapprochement par interrogation
- **CA53 [PG+HTTP]** Given un paiement `en_attente`, `prochaine_verification` échue, faux K-PAY `COMPLETED` (`feeAmount: 250`), When `verifierPaiementsDus(now)`, Then `reussi`, prolongation, `frais_reels=250`, `net_reel=4750`, événement `source='interrogation'`.
- **CA54 [PG]** Given CA53, When le webhook `payment.completed` arrive ensuite, Then 200 doublon, `expire_le` inchangé.
- **CA55 [PG+HTTP]** Given webhook et interrogation simultanés pour le même paiement, Then une seule prolongation.
- **CA56 [PG+HTTP]** `PROCESSING` → reste `en_attente`, `verifications` +1, `prochaine_verification` selon le calendrier (15, 30, 60, 120, 300, 300… s).
- **CA57 [PG]** Paiement `initiation_incertaine` sans id → jamais interrogé ; passé `expire_avant` → `expire`, `messageEchec` = `EXPIRE`.
- **CA58 [PG]** Lot : 12 paiements dus → un tick n'en traite que 5 ; deux ticks concurrents (`Promise.all`) ne traitent jamais le même paiement (`SKIP LOCKED`).

### Cycle de vie de l'abonnement
- **CA59 [U]** `resoudrePlanEffectif` avec `expire_le = 2026-12-03T23:00Z` : à 22:59:59Z → `actif`, `joursRestants=1`, `dernierJourInclus='2026-12-03'` ; à 23:00:00Z → `grace`, `graceJusquau=2026-12-10T23:00Z` ; à 2026-12-10T23:00Z → `gratuit` ; sans abonnement → `gratuit`.
- **CA60 [U]** `calculerNouvelleEcheance` : actif jusqu'à 2026-12-03T23:00Z, renouvellement de 3 mois le 2026-11-20 → `2027-03-03T23:00Z` (repart de l'échéance).
- **CA61 [U]** En grâce (now 2026-12-06T10:00Z), renouvellement d'1 mois → base = now → 2027-01-06 11:00 locale → `2027-01-06T23:00Z` (la grâce n'est pas facturée).
- **CA62 [U]** Fin de mois : now 2027-01-31T09:00Z, 1 mois → 2027-02-28 → minuit suivant `2027-02-28T23:00Z` ; `Europe/Paris`, now 2027-03-10T11:00Z, 1 mois → `2027-04-10T22:00Z` (heure d'été).
- **CA63 [PG]** Deux paiements différents (1 et 3 mois) confirmés en parallèle pour le même utilisateur gratuit → `expire_le` final = now + 4 mois arrondi (aucune mise à jour perdue), `abonnement_expire_avant/apres` chaînés.
- **CA64 [PG]** Abonnement en grâce → plan effectif `payant` : 5 services visibles, pas de badge, création d'un 6e service autorisée.
- **CA65 [PG]** Retour au gratuit : 5 services (créés de J1 à J5), dont un en vedette (le 5e). Le lendemain de la fin de grâce, `getPublicServices` renvoie les 3 plus anciens ; le détail du 4e → 404 ; `contenus.services = 3` ; **les 5 lignes existent toujours en base** (`count = 5`, aucune modification de `actif`).
- **CA66 [PG]** CA65 puis un paiement confirmé → les 5 services réapparaissent sans aucune écriture sur `services`.
- **CA67 [PG]** CA65 : l'utilisateur masque le service n°1 au studio → les services 2, 3 et 4 deviennent visibles publiquement.
- **CA68 [PG]** `GET /api/studio/abonnement` en grâce → `etat='grace'`, `graceJusquau`, `renouvellementAutomatique=false`, `paiementEnCours=null`.
- **CA69 [PG]** Seed : `dr-cabrel` gratuit (badge), `dr-cabrel-payant` actif (pas de badge, 5 services visibles), `dr-cabrel-grace` en grâce (pas de badge).
- **CA70 [PG]** Liste studio en gratuit avec 5 services → `masqueParPlan` vrai pour les 4e et 5e, `limitePlan = { limite: 3, utilise: 5, atteinte: true }`.

### Rappels et reçu
- **CA71 [PG]** Given `expire_le = 2026-12-03T23:00Z` (J0 = 3 décembre), When la planification tourne le 2026-11-26 à 07:55Z (08:55 locale), Then aucune ligne ; à 08:00Z → une ligne `abonnement_rappel`, `occurrence='J7:2026-12-03T23:00:00.000Z'` ; à 08:05Z → toujours une seule.
- **CA72 [PG]** Même abonnement → lignes J3 le 30 novembre et J0 le 3 décembre ; aucune le 1er décembre ; aucune après 15:00 locale (rattrapage) ni pour un fuseau invalide (compté dans le journal).
- **CA73 [PG]** Ligne J7 planifiée puis renouvellement (nouvelle échéance), When envoi, Then `annule`/`ABONNEMENT_RENOUVELE`, transport non appelé ; nouvelles lignes J7, J3 et J0 sur la nouvelle échéance aux bonnes dates.
- **CA74 [PG]** Contenu J3 : objet « Votre abonnement se termine dans 3 jours », mention « ne se renouvelle pas automatiquement », date « 3 décembre 2026 », grâce de 7 jours, « rien n'est supprimé », lien `{site}/studio/compte?periode=1#abonnement` ; pas d'en-tête `List-Unsubscribe`.
- **CA75 [PG]** Compte à e-mail temporaire sans `email_contact` → aucun rappel planifié.
- **CA76 [PG]** `paiement_confirme` : contient le montant « 48 000 FCFA », « 12 mois », « MTN MoMo », `+237 6•• ••• •89`, la nouvelle échéance ; ne contient pas le numéro complet ; envoyé une seule fois malgré un webhook rejoué (CA39).
- **CA77 [PG]** Tick S9 : `planifierNotifications` renvoie `rappelsAbonnement` ; les tests S9 existants restent verts.

### Quotas
- **CA78 [PG]** Gratuit, 3 services (dont 1 masqué), When `POST /api/studio/services`, Then 403 `{ code: 'LIMITE_PLAN_ATTEINTE', ressource: 'services', limite: 3, utilise: 3, plan: 'gratuit' }`, message de déblocage, aucune ligne créée.
- **CA79 [PG]** Gratuit à 2 services, **deux créations simultanées** (`Promise.all`) → exactement une 201 et une 403 ; 3 lignes en base.
- **CA80 [PG]** Même chose pour les réalisations et les témoignages (CA78 + CA79 chacun).
- **CA81 [PG]** Payant actif à 10 services → création 201.
- **CA82 [PG]** Vitrine gratuite avec 10 réservations (`en_attente`, `confirmee`, `terminee`) créées en novembre (heure de Douala), When un visiteur réserve le 2026-11-30T22:30Z (23:30 locale, toujours novembre), Then 409 `RESERVATIONS_INDISPONIBLES`, message sans le mot « plan ». Le 2026-11-30T23:30Z (00:30 le 1er décembre en heure locale) → 201.
- **CA83 [PG]** Même vitrine avec 9 réservations actives + 3 `refusee` ou `annulee` → la 10e est acceptée, la 11e refusée.
- **CA84 [PG]** 9 réservations, **deux POST simultanés sur deux créneaux différents** → une 201, une 409 `RESERVATIONS_INDISPONIBLES`.
- **CA85 [PG]** Quota de réservations atteint → `creneaux` renvoie `{ creneaux: [], suspendues: true }` ; les demandes (devis) restent possibles.
- **CA86 [PG]** IA gratuit, 2 `terminee` + 1 `en_cours` ce mois → `POST /api/studio/ia/ameliorer` → 403 `generations_ia_mois` ; 2 `terminee` + 1 `repli` → autorisé (les replis ne consomment pas).
- **CA87 [PG]** 2 générations et **deux demandes d'amélioration simultanées avec des entrées différentes** → une créée, une 403.
- **CA88 [PG]** Onboarding avec quota IA atteint → génération `repli`/`quota_atteint`, sans appel au fournisseur ; l'inscription aboutit.
- **CA89 [PG]** `terminer` avec une limite de services configurée à 2 et 3 services proposés → 2 services créés, publication réussie.
- **CA90 [U]** `assertQuota` : `limite: null` → jamais d'erreur et **aucun verrou consultatif pris** (espion sur l'exécuteur).

### Masquage et badge
- **CA91 [PG]** Vitrine gratuite → `GET /api/public/dr-cabrel` → `badgeBrandself: true` ; payante active → `false` ; aucun champ d'abonnement (`expireLe`, `plan`) dans le DTO public.
- **CA92 [PG]** Gratuit avec 5 réalisations et 5 témoignages → listes publiques de 3 (les plus anciens) ; détail d'une réalisation masquée → 404.
- **CA93 [PG]** Gratuit : le seul service réservable est le 4e (masqué) → `contenus.agenda=false`, créneaux 404, `POST` réservation sur ce service → 404 `SERVICE_INTROUVABLE`, `POST` demande → 404.
- **CA94 [PG]** Service en vedette masqué par le plan → absent de « à la une » ; le compteur « Voir tous (n) » vaut 3.

### Routes et sécurité
- **CA95 [E2E api]** Les 3 routes studio S10 sans session → 401 (ajout à `e2e/api/studio-auth.spec.ts`).
- **CA96 [PG]** `GET /api/public/tarifs` → plans avec limites issues de la configuration, `offre.devises` = XAF seule avec les 3 périodes ; `?devise=EUR` → la devise par défaut reste XAF (EUR non payable) ; aucune clé ni identifiant K-PAY dans la réponse.
- **CA97 [U]** Aucune chaîne de prix (`5000`, `13500`, `48000`) ni de limite (`3`, `10`) n'apparaît dans `app/**` (test statique : grep des littéraux dans les fichiers S10 de `app/`).
- **CA98 [PG]** Journaux de CA27 à CA58 : ni numéro, ni clé, ni secret, ni corps K-PAY (espion).
- **CA99 [PG]** Le webhook n'exige ni session ni Origin ; un cookie de session présent n'a aucun effet.

### Interface (e2e, faux serveur K-PAY lancé par le `globalSetup`, `KPAY_BASE_URL=http://127.0.0.1:<port>`, webhook signé envoyé par le faux serveur 2 s après l'initiation)
- **CA100 [E2E]** Gratuit à 3 services, When « Ajouter un service », Then **un seul** message de limite à l'écran, avec le bouton « Voir l’abonnement » qui mène à `/studio/compte#abonnement` ; aucune autre erreur technique visible.
- **CA101 [E2E]** Compte gratuit, When je choisis 12 mois, MTN MoMo, `653456789`, puis « Payer 48 000 FCFA », Then l'état « Validez le paiement sur votre téléphone » s'affiche avec le numéro masqué, puis « Votre plan payant est actif jusqu'au … » sans rechargement ; la vitrine publique n'affiche plus « Créé avec Brandself ».
- **CA102 [E2E]** Numéro de test `653456029` (le faux serveur renvoie `payment.failed`/`PAYER_NOT_FOUND`) → message correspondant + « Réessayer » ; le numéro saisi est conservé dans le champ.
- **CA103 [E2E]** Rechargement de Compte pendant un paiement en cours → l'état d'attente reprend (`paiementEnCours`).
- **CA104 [E2E]** Les choix de période et de moyen sont des `radio` accessibles au clavier ; aucun `checkbox` ; la mention « Ne se renouvelle pas automatiquement » est visible ; 12 mois porte « Le plus avantageux ».
- **CA105 [E2E]** `/tarifs` à 390 et 1280 px : 2 plans, prix XAF de l'API, aucune barre de défilement horizontale, pas de sélecteur de devise (une seule devise payable), lien « Commencer gratuitement » vers `/connexion`.
- **CA106 [E2E]** Studio en grâce (seed `dr-cabrel-grace`) → bandeau unique « Votre abonnement est terminé. Vous gardez tout jusqu'au … » à la place de la prochaine étape (0 ou 1 message à la fois).
- **CA107 [E2E]** Vitrine gratuite avec le quota de réservations atteint → le bloc agenda affiche le message au visiteur avec un lien de contact, sans créneau.

### Réception SPRINTS
- « Paiement sandbox active le plan » = CA38 + CA101 (faux serveur), + CA25 si l'essai réel est fait.
- « Webhook rejoué ne change rien » = CA39 + CA40.
- « Signature invalide rejetée » = CA41.
- « Expiration simulée » = CA59, CA65, CA66, CA71 à CA73.
- « 4e service » = CA78 + CA100.
- « `/tarifs` et Compte dans la devise choisie » = CA96 + CA105 (XAF seule payable : écart #105).

---

## 7. Frontend

Avant de coder : lire les maquettes `Studio-Compte` et `Tarifs-PC`. **Si elles sont absentes, s'arrêter et le signaler.** Lire aussi 2 ou 3 composants voisins (`compte.vue`, `PartageVitrine.vue`, `ProchaineEtape.vue`).

- **Compte** (`compte.vue` → `components/studio/abonnement/AbonnementCarte.vue`, `ChoixPeriode.vue`, `ChoixMoyen.vue`, `SuiviPaiement.vue` ; composables `useAbonnement.ts`, `usePaiementAbonnement.ts`).
  - États : gratuit (quotas utilisés / limite), actif (« Actif jusqu’au {date} inclus », « Il vous reste {n} jours »), grâce, paiement en cours, succès, échec, paiement indisponible.
  - Formulaire : période en `URadioGroup` (cartes), prix de l'API, moyen en `URadioGroup`, numéro avec préfixe fixe `+237` lu dans le moyen, bouton « Payer {montant} » ou « Renouveler maintenant ».
  - Mentions : « Ne se renouvelle pas automatiquement. Nous vous écrirons 7 jours avant la fin. » ; frais jamais affichés si supporteur `marchand`.
  - Suivi : 5 s, pause si l'onglet est masqué, arrêt sur statut terminal ou à 3 min (« Nous attendons encore la confirmation de l'opérateur. Vous recevrez un e-mail dès qu'elle arrive. »).
  - Query `?periode=` présélectionne la période. Zones ≥ 44 px, `aria-live` pour les changements d'état.
- **`/tarifs`** (`app/pages/tarifs.vue`, `components/tarifs/*`, `useTarifs.ts`) : SSR, palette Brandself. Gratuit et Payant côte à côte (empilés à 390 px), limites lues dans l'API (« Illimité »), choix de période, honnêteté (« Vous payez une période. Pas de renouvellement automatique. 7 jours de grâce, rien n'est supprimé. »), boutons vers `/connexion` et `/studio/compte#abonnement`. Sélecteur de devise seulement si plusieurs devises sont payables.
- **Message de limite** (`components/studio/LimitePlanMessage.vue`, `useLimitePlan.ts`) : sur les listes Services, Réalisations et Témoignages, « Ajouter » affiche le message à la place de la navigation si `limitePlan.atteinte` ; les formulaires `nouveau.vue` traitent le 403 de la même façon (filet de sécurité) ; même chose pour le bouton IA du Profil et pour l'Agenda studio (quota de réservations). Étiquette « Masqué sur la vitrine » (non colorée, texte secondaire) sur les lignes `masqueParPlan`.
- **Bandeau de grâce** (`components/studio/AbonnementBandeau.vue`) dans `studio/index.vue`, prioritaire sur `ProchaineEtape` et `messagePublication` (un seul affiché).
- **Public** : `Pied.vue` et `@[username].vue` affichent le badge selon `badgeBrandself` ; `AgendaPublic.vue` gère `suspendues` ; formulaire de réservation : message de 409 `RESERVATIONS_INDISPONIBLES`.
- Vocabulaire : « vitrine », « service »… ; aucune fenêtre promotionnelle ; Phosphor (`i-ph-device-mobile`, `i-ph-check-circle`, `i-ph-hourglass`) ; aucune couleur en dur.

---

## 8. Découpage en lots (périmètres de fichiers disjoints)

| Lot | Agent | Fichiers (exclusifs) | Prérequis | Taille |
|---|---|---|---|---|
| **A**, base et contrats | database + backend | `shared/db/schema.ts` ; `server/db/migrations/0021_s10_abonnements.sql`* + `meta/0021_snapshot.json`* + `meta/_journal.json` ; `shared/plans.ts`*, `shared/paiements.ts`*, `shared/schemas/abonnement.ts`*, `shared/dto/abonnement.ts`*, `shared/dto/index.ts`, DTO publics et studio touchés (`shared/dto/vitrine*`, `service*`, `realisation*`, `temoignage*` : champs §3.6), `shared/erreurs.ts`, `server/exceptions/http.ts`, `shared/limites.ts`, `shared/jobs.ts`, `shared/notifications.ts` (codes), `shared/ia.ts` (motif, alias PlanId), `shared/env.ts`, `server/config/plans.ts`, `server/config/paiements.ts`*, `server/services/email-outbox.ts` (**seulement** l'union `EmailEntityType`) | — | M |
| **F1**, tests RED | tester | `tests/unit/**`, `tests/integration/**` (fabriques, faux serveur K-PAY `tests/support/faux-kpay.ts`*), `tests/sandbox/kpay.sandbox.test.ts`* + projet `sandbox` dans `vitest.config.ts`, `e2e/api/abonnement.spec.ts`*, `e2e/api/studio-auth.spec.ts` | A | L |
| **B1**, PlanService, quotas, masquage | backend | `server/services/plans.ts`, `plans-regles.ts`*, `plan-visibilite.ts`*, `services.ts`, `realisations.ts`, `temoignages.ts`, `vitrines.ts`, `creneaux.ts`, `reservations.ts`, service de création des demandes, `ia/generations.ts`, `onboarding.ts`, `server/resources/{vitrine,service,realisation,temoignage}.ts` | A, F1 | L |
| **B2**, paiements, webhook, worker, seed | backend | `server/services/paiements/**`*, `server/services/abonnements.ts`*, `abonnements-regles.ts`*, `webhooks-paiement.ts`*, `server/resources/abonnement.ts`*, `server/api/studio/abonnement/**`*, `server/api/public/tarifs/index.get.ts`*, `server/api/webhooks/[fournisseur].post.ts`*, `server/plugins/config-paiements.ts`* (appel de `assertConfigPaiements`), `server/jobs/paiements.ts`*, `worker/index.ts`, `server/db/seed.ts` | A, F1 ; `getPlanEffectif` de B1 (contrat figé en A : B2 n'appelle que la signature) | L |
| **B3**, rappels et e-mails | backend | `server/services/notifications/abonnements.ts`*, `notifications/planification.ts`, `notifications/pertinence.ts`, `server/services/email-outbox.ts` (chargeurs), `server/services/emails/contenus.ts`, `emails/notifications-contenus.ts` | A, F1 (parallèle à B1 et B2 ; lit `abonnements` via le schéma) | M |
| **D**, Compte et tarifs | frontend | `app/pages/studio/compte.vue`, `app/components/studio/abonnement/**`*, `app/composables/useAbonnement.ts`*, `usePaiementAbonnement.ts`*, `app/pages/tarifs.vue`*, `app/components/tarifs/**`*, `app/composables/useTarifs.ts`* | A (parallèle à F1) ; vérifier la forme réelle des réponses de B2 avant la fin | M |
| **E**, limites, bandeau, public | frontend | `app/components/studio/LimitePlanMessage.vue`*, `app/composables/useLimitePlan.ts`*, `app/components/studio/AbonnementBandeau.vue`*, `app/pages/studio/{services,realisations,temoignages}/index.vue` et `nouveau.vue`, composant du bouton IA du Profil (à localiser), page Agenda studio, `app/pages/studio/index.vue`, `app/components/vitrine/Pied.vue`, `app/pages/@[username].vue`, `app/components/vitrine/AgendaPublic.vue`, `ReservationForm.vue` / `useReservation.ts` | A ; réponses de B1 | M |
| **F2**, e2e UI | e2e-tester | `e2e/abonnement.spec.ts`*, `e2e/helpers/abonnement.ts`*, `e2e/support/faux-kpay.ts`* (serveur + envoi de webhooks signés), `playwright.config.ts` / `global-setup` (démarrage du faux serveur, variables) | B1, B2, B3, D, E | M |
| **G** | reviewer + security (opus, **obligatoire**) + regression-checker + ux-reviewer | lecture seule | F2 | M |
| **H** | thread principal | `.env.example` (5 variables), `PROJECT_STATE.md`, `docs/JOURNAL_DECISIONS.md` (#103 à #134), `deploy/nginx/` (location webhook), notes de déploiement | G | S |

\* = fichier créé.

**Ordre** : A → (F1 ∥ D) → (B1 ∥ B2 ∥ B3) → E → F2 → G → H. Au plus 3 cycles RED → GREEN par lot ; au-delà, retour à l'architecte.

**Consommateurs à vérifier en G** :
- tous les appelants de `getPlanForUser` et `getIaQuota` ;
- `IaPlan` ;
- `VitrinePubliqueDTO` et `ContenusPublicsDTO` (pages publiques, e2e « Créé avec Brandself ») ;
- compteurs des listes studio ;
- réponse de `creneaux` ;
- `createReservation` (e2e S7, test de concurrence S7) ;
- `TRANSACTIONAL_EMAIL_TYPES` et les tests qui les listent ;
- `planifierNotifications` (forme du retour) ;
- `MOTIFS_REPLI` ;
- seed (`dr-cabrel` inchangé).

---

## 9. Risques et mitigations

| Risque | Mitigation |
|---|---|
| Webhook manqué (dev sans tunnel, panne) | Rapprochement par le worker ; `completed` tardif appliqué (#111) |
| Paiement pris mais initiation incertaine (délai, 409) | Rapprochement par `externalId` dans le webhook ; expiration locale non finale vis-à-vis de `completed` |
| Budget de 100 appels/min épuisé | Suivi côté serveur, compteur global fail-closed, lot borné |
| Fraude par webhook forgé | HMAC sur le corps brut en temps constant, contrôle du montant, `externalId` et id connus, aucune activation en cas d'anomalie |
| Rejeu | Unicité `(fournisseur, id_transaction, evenement)` + `applique_le` sous verrou |
| Spam USSD vers un tiers | Limite par empreinte de numéro + par utilisateur, plafond de paiements ouverts, fail-closed |
| Fuite du numéro | Jamais stocké (CHECK sur le masque), jamais journalisé, jamais dans Redis |
| Clé de test en production | Refus au démarrage (#118) |
| Prix provisoires en production | Refus au démarrage (#106) |
| Argent bloqué dans un portefeuille étranger | Seuls les pays du Cameroun sont actifs (#104, Q2) |
| Quotas dépassés sous concurrence | Verrous (#124), CA79, CA84, CA87 |
| Épuisement du quota de réservations par un tiers | Refus et annulations exclus, limiteurs S7 existants |
| Régression des pages publiques (masquage) | Module unique, CA65 à CA67 et CA91 à CA94, e2e S3 à S7 rejoués |
| Cache public S12 et état dépendant du temps | Noter pour S12 : TTL plus court que la prochaine bascule, ou invalidation par le tick |
| Dérive des CHECK recopiés | Commentaires « garder synchronisés » + test qui compare les constantes aux CHECK |
| Montant du webhook net plutôt que brut (non documenté) | CA42 détecterait l'écart en anomalie et rien ne serait activé ; à confirmer avec K-PAY (Q4) avant la production |
| Frais réels ≠ estimés | Snapshot estimé + réels au rapprochement ; écart visible en base |
| Stockage des médias non plafonné en gratuit | Hors S10, à surveiller |

---

## 10. Variables d'environnement et prérequis à fournir

| Variable | Dev | Production |
|---|---|---|
| `KPAY_API_KEY` | `kpay_test_…` (présente) | `kpay_live_…` |
| `KPAY_SECRET_KEY` | présente | live |
| `KPAY_WEBHOOK_SECRET` (nom à confirmer) | fourni dans `.env` local (2026-11-03) | **obligatoire** |
| `KPAY_BASE_URL` | absente (défaut), ou `http://127.0.0.1:<port>` pour les tests | absente (défaut https) |
| `KPAY_MODE_TEST_AUTORISE` | — | `true` seulement en préproduction |

**Prérequis côté K-PAY** :
1. URL de rappel Payin configurée dans l'application (sans elle, la sandbox répond 400). En dev, un tunnel HTTPS (cloudflared ou ngrok) vers `/api/webhooks/kpay` ; en production `https://brandself.io/api/webhooks/kpay`.
2. Pays d'origine du compte et pays sélectionnés (Cameroun).
3. Nom légal et activité renseignés.
4. Secret de webhook de l'application.

**Nginx** : `location = /api/webhooks/kpay` avec `client_max_body_size 16k`, pas de cache, `limit_req` léger, `X-Forwarded-For $remote_addr`.

---

## 11. Paramètres à rendre configurables depuis le futur panel admin

- **Plans** : limites par ressource, badge, jours de statistiques, périodes (1, 3, 12), période mise en avant.
- **Prix** : par plan, devise et période ; statut de validation.
- **Grâce** : 7 jours. **Rappels** : J-7, J-3, J0 ; heure (9 h) ; rattrapage (6 h).
- **Moyens de paiement** : fournisseur, méthode, opérateur, pays, indicatif, format national, devise, minimum, actif.
- **Frais** : taux en points de base par (fournisseur, méthode) ; supporteur (marchand ou client).
- **K-PAY** : délais (10 s, 8 s), budget d'appels (60/min), tick (10 s), lot (5), calendrier des vérifications, expiration (15 min), taille maximale du webhook (16 Ko).
- **Abus** : limites d'initiation par utilisateur et par numéro, plafond de paiements ouverts (2), délai de relance (60 s), limite de suivi.
- **Interface** : intervalle (5 s) et durée maximale (3 min) du suivi.
- **Textes** : messages de limite, messages d'échec par code, modèles d'e-mails.

---

## 12. Hors périmètre (idées)

Carte bancaire (second adaptateur), remboursements, factures PDF numérotées, interface d'administration, `availability` pour masquer un opérateur instable, `predict-provider` pour présélectionner l'opérateur, e-mail « fin de grâce », e-mail au professionnel quand son quota de réservations est atteint, consultation de `GET /api/public/platform-info` pour les frais et minimums en direct, historique des paiements dans Compte, codes promotionnels, purge légale des paiements.

---

## 13. Questions ouvertes (avec proposition)

1. **Prix (#1).** Proposition : grille provisoire 5 000 / 13 500 / 48 000 XAF, bloquée en production tant que non validée.
2. **Pays d'origine du compte K-PAY et pays activés.** Proposition : Cameroun seul (Orange et MTN). Activer d'autres pays impose TopOf pour récupérer l'argent.
3. **Nom exact de la variable du secret de webhook** (supposé `KPAY_WEBHOOK_SECRET`, déjà fourni dans `.env`) ; **URL de rappel** à enregistrer chez K-PAY (production + tunnel pour les essais locaux). Sans URL de rappel, l'activation ne passe que par l'interrogation (≤ 5 min de délai).
4. **Le `amount` du webhook est-il brut ou net ? Et la devise est-elle absente du webhook ?** À confirmer avec K-PAY (support@kpay.site). Proposition : brut (comme `init` et `GET`).
5. **Qui supporte les frais.** Proposition : Brandself (prix affiché = prix payé).
6. **Droits pendant la grâce.** Proposition : ceux du payant (#121). Alternative : gratuit dès l'échéance, la grâce ne servant que de délai avant le masquage.
7. **Codes USSD manuels** (`*126#`, `#150#`) à afficher si la notification n'arrive pas. Absents de la doc K-PAY : à fournir, sinon texte générique.
8. **Remboursement et litige** : procédure manuelle depuis le tableau de bord K-PAY ? Proposition : oui, à documenter dans les CGU.
9. **Seed** : variantes `dr-cabrel-payant` et `dr-cabrel-grace` de la même persona. Acceptable ?
10. **Paiement passé à `REFUNDED`** : retirer la période ? Proposition : non automatique, alerte et décision manuelle.
11. **Fiscalité** : prix TTC, TVA (Cameroun), conservation des pièces. Proposition : prix TTC affichés, conservation sans purge en S10.
12. **Suppression du compte avec abonnement actif** : aucun remboursement. À écrire dans les CGU et sur l'écran de suppression ?
13. **Utilisateurs dont `devise = EUR` ou `USD`** : prix XAF affichés avec la note « Le paiement se fait aujourd'hui par Mobile Money, en francs CFA. » Acceptable ?
14. **Initiation synchrone (#108)** plutôt qu'un job avec numéro chiffré : à valider.
15. **Maquettes `Studio-Compte` et `Tarifs-PC`** : introuvables par mes outils. Les placer ou confirmer leurs noms de fichiers.

---

## Fichiers clés

- /home/cabrel/projects/brandself-app/brandself-app/shared/db/schema.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/env.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/jobs.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/ia.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/notifications.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/config/plans.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/services/plans.ts (`getPlanForUser` renvoie toujours `'gratuit'`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/services.ts (`insertService` sous `lockVitrineId`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/vitrines.ts (`getPublicVitrinePage`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/reservations.ts (`createReservation`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/creneaux.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/services/ia/generations.ts (`createGeneration`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/email-outbox.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/services/limiteur.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/resources/vitrine.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/utils/api.ts
- /home/cabrel/projects/brandself-app/brandself-app/worker/index.ts
- /home/cabrel/projects/brandself-app/brandself-app/app/pages/studio/compte.vue (carte statique L82-96)
- /home/cabrel/projects/brandself-app/brandself-app/kpay_doc.md
- /tmp/claude-1000/-home-cabrel-projects-brandself-app-brandself-app/7ddecfd1-d67c-49c0-9dff-6b723f5d38cf/scratchpad/kpay-openapi.json

## Annexe : arbitrages de l'orchestrateur (2026-11-03)

- Secret de webhook fourni en local ; nom supposé `KPAY_WEBHOOK_SECRET` (à confirmer par l'utilisateur ; sinon le lot A garde le nom réel dans `shared/env.ts` et `.env.example`, sans alias).
- Utilisateur : K-PAY = Orange Money + MTN MoMo uniquement ; carte bancaire = autre fournisseur plus tard (interface `PaiementProvider`, #103) ; frais configurables (#107).
- Questions 1, 2, 4–14 : défauts proposés retenus pour l'implémentation, à confirmer avant la production (prix provisoires bloqués en production par `PRIX_STATUT`).
