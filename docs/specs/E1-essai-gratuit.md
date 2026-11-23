# E1 — Essai gratuit à la création de la vitrine

Spec de l'architecte (2026-11-23). Décisions de départ : `docs/JOURNAL_DECISIONS.md` (2026-11-17). Tier renforcé le temps de la feature (abonnement + données personnelles). « NON VÉRIFIÉ » = non lu dans le code par l'architecte, à confirmer avant de coder.

## 1. Challenge (écarts avec le brief)

- **Pas d'acteur « système » dans `journal_admin`** : `journal_admin.admin_id` est `NOT NULL REFERENCES users`, et la chaîne de hachage passe par un verrou consultatif global. `TransactionAdmin` n'est qu'un alias de transaction : `offrirJours` accepte toute transaction. La trace de l'essai est la ligne `essais` (D5).
- **Compteur de conversions** : impossible sur `abonnements.origine` (`prolonger` la remet à `paiement`, et la ligne disparaît avec le compte). Table `essais` avec `converti_le`, qui survit au compte (D11).
- **Deux chemins de création de vitrine** : `terminer` (onboarding.ts, seul utilisé par l'interface) et `createVitrine` (`POST /api/studio/vitrine`, sans transaction). Les deux appellent le même service.
- **Collision jour 7** : le rappel J-7 existant tombe le jour de l'e-mail « statistiques » pour 14 jours : J-7 supprimé pour `origine = essai`.
- **J-3 et J0** parlent d'« abonnement » : variante « essai ».
- **`versOrigine`** (abonnements-offrir.ts, admin/utilisateurs.ts) transforme toute origine inconnue en `paiement` ; les schémas `z.enum(ABONNEMENT_ORIGINES)` lèveraient une 500 : mettre à jour dans le même lot que la migration.
- **Ordre dans `terminer`** : l'essai est accordé AVANT le calcul du quota de services, sinon des services sont jetés alors que la personne a 14 jours de plan payant.
- **Comptes téléphone seuls** : l'e-mail est temporaire (`@TEMP_EMAIL_DOMAIN`), la clé est le numéro vérifié.
- **Retiré** : déclenchement sur `publishVitrine` (un compte d'avant E1 qui dépublie puis republie recevrait un essai) ; rattrapage des empreintes des comptes existants (le SQL ne peut pas calculer le HMAC).

## 2. Décisions (⚠️ = défaut appliqué, à confirmer)

- **D1** Déclencheur : `terminer` et `createVitrine`, dans leur transaction, après l'INSERT de la vitrine, avant le quota de services. Aucun rétroactif.
- **D2** Origine `essai` : CHECK étendu, `ABONNEMENT_ORIGINES` + `essai`, `offrirJours(..., origineCreation: 'offert' | 'essai' = 'offert')`. Un paiement fait passer à `paiement` (existant).
- **D3** Durée : catégorie A5 `essai`, clé `inscription`, valeurs `{ actif, dureeJours 1..90, relanceServicesJour, relanceStatistiquesJour }` avec `1 ≤ services < statistiques < durée`. Seed v1 `{ true, 14, 2, 7 }`. Lecture SANS cache dans la transaction. Repli sur `ESSAI_DEFAUT` (= v1) : ⚠️ repli « ouvert » (c'est un cadeau, pas un encaissement). Un changement ne touche que les essais accordés ensuite. Les tests qui activent une autre version appellent `restaurerConfiguration()`.
- **D4** Marqueur anti-abus : table `essais_empreintes`, HMAC-SHA256 sur clé HKDF dérivée d'un secret DÉDIÉ `ESSAI_EMPREINTE_SECRET` (décision Cabrel : l'empreinte ne dépend plus du secret d'authentification, qui peut être tourné sans rouvrir les essais). Variable validée au démarrage (`shared/env.ts`, min. 32 caractères), OBLIGATOIRE en production, avec repli dérivé de `NUXT_BETTER_AUTH_SECRET` (label HKDF distinct) hors production seulement ; ne jamais la tourner ni la perdre (à documenter dans `docs/exploitation-admin.md`). HKDF `info = jesuispro:essai-empreinte:v1`, sans FK vers `users`, sans donnée en clair. Clés : e-mail `trim().toLowerCase()` (ignoré si temporaire), numéro vérifié en chiffres seuls. Pas de normalisation Gmail/alias `+tag`. ⚠️ Un numéro ajouté après l'essai n'est pas enregistré.
- **D4bis** Comptes d'avant E1 (décision Cabrel) : l'application n'est pas en production, donc AUCUN rattrapage ni migration pour eux. E1 est déployé avant les premiers vrais comptes ; la base de développement peut être purgée. Si un jour des comptes existaient sans empreinte, un script TypeScript de rattrapage (le SQL ne peut pas calculer le HMAC) serait à écrire à ce moment-là.
- **D5** Aucun `journal_admin`.
- **D6** Éligibilité sous verrou `abonnement:<userId>`, dans l'ordre : config `actif` → aucun abonnement → aucun essai pour ce compte → au moins une clé → aucune clé déjà présente. Insertion des empreintes `ON CONFLICT DO NOTHING RETURNING` ; une ligne manquante annule le savepoint (`deja_consomme`).
- **D7** Concurrence : `terminer` déjà idempotent ; `createVitrine` contre `terminer` : unicité `vitrines_user_id` ; unicité `essais.user_id` et `abonnements.user_id`.
- **D8** E-mails `abonnement_essai_services` (jour 2) et `abonnement_essai_statistiques` (jour 7) : planifiés dans l'outbox à l'octroi (9 h locale, fuseau du compte, repli Douala), revalidés à l'envoi. Annulation : `ENTITE_INTROUVABLE`, `ESSAI_TERMINE` (origine ≠ essai), `RAPPEL_PERIME`, `DESTINATAIRE_ABSENT`, `CONTENU_DEJA_AJOUTE` (« services » seulement). Catégorie `relationnel` (décision Cabrel : chaque e-mail porte un lien de désabonnement), préférence `email_hebdo` réutilisée (aucune nouvelle colonne), jeton signé existant (`signUnsubscribeToken`), annulation `PREFERENCE_DESACTIVEE` si désactivée. Les rappels J-3 et J0 de fin d'essai restent `transactionnel` (fin d'accès).
- **D9** J-3 et J0 : J-7 sauté pour un essai (`ESSAI_RAPPELS_JOURS = [3, 0]`), variante `essai: true` du contenu `abonnement_rappel`, même lien de renouvellement. **Pas de grâce pour un essai** (défaut : un essai de 14 jours dure 14 jours ; la grâce de 7 jours est faite pour un payeur qui oublie de renouveler). `getPlanEffectif` : grâce appliquée seulement si `origine <> 'essai'` ; un essai prolongé par l'admin garde `essai`, donc pas de grâce non plus. À inverser si Cabrel le souhaite.
- **D10** Affichage : `terminer` renvoie `essai: { finLe, dureeJours } | null` ; DTO d'abonnement du studio `essai: { finLe } | null` ; `/tarifs` et landing : `essai: { actif, dureeJours }`. Texte : « 14 jours du plan payant offerts à la création de votre vitrine. Aucun paiement demandé. » ; jamais « sans engagement » ni « résiliable ».
- **D11** Conversions : `prolonger(..., paiementId ≠ null)` exécute `UPDATE essais SET converti_le = now WHERE user_id = $1 AND converti_le IS NULL`. Indicateur admin sur 30 jours (accordés, en cours, convertis, taux).
- **D12** Retour au plan gratuit par l'admin pendant un essai : l'essai reste consommé, ses e-mails s'annulent.

## 3. Migration `0036_e1_essai_gratuit.sql`

1. `abonnements_origine_check` : `('paiement','offert','admin','essai')` (NOT VALID puis VALIDATE).
2. `configuration_versions_categorie_check` + `'essai'` ; CHECK `categorie <> 'essai' OR cle = 'inscription'` ; seed `e1000000-essai-inscription-1` (`systeme`).
3. Table `essais` (`id`, `user_id` FK `ON DELETE SET NULL`, `debut_le`, `fin_le`, `duree_jours 1..90`, `version_id`, `converti_le`), unique partiel sur `user_id`, déclencheur `essais_proteger` (immuable sauf `user_id → NULL` et `converti_le NULL → valeur`, DELETE interdit 42501).
4. Table `essais_empreintes` (`empreinte` PK `^[0-9a-f]{64}$`, `nature`, `essai_id` FK `RESTRICT`, `cree_le`).
5. Outbox : deux types ajoutés à `emails_transactionnels_type_check` (recopier la liste COMPLÈTE de 0020/0029) et à `…_occurrence_requise_check`.
6. Bloc ROLLBACK manuel. Numéro 0036 déduit de 0035 ; journal NON VÉRIFIÉ.

## 4. Contrats de service

- `shared/essai.ts` : constantes (`ESSAI_CLE_CONFIG`, `ESSAI_DEFAUT`, durées min/max, `ESSAI_RAPPELS_JOURS`, `ESSAI_EMPREINTE_HKDF_INFO`, `ESSAI_OCCURRENCE_PREFIXE`) et types (`RaisonRefusEssai`, `EssaiDTO`).
- `shared/schemas/admin-versions.ts` : `schemaValeursEssai` strict, `schemaCreerVersionEssai`, union `schemaVersionDto` ; `shared/admin.ts` : `ADMIN_VERSION_TYPES`, `VERSION_CATEGORIES`, `VERSION_CATEGORIE_PAR_TYPE`.
- `lecture.ts` : `lireConfigEssai(options)` (revalidation Zod, repli code, ne lève jamais) ; adaptateur `configuration/adaptateurs/essai.ts` sur le modèle de `frais.ts` (sans aperçu d'impact).
- `server/services/essai.ts` : `empreinteEssai`, `clesEssai` (pures) ; `accorderEssaiSiEligible(tx, userId, now)` (savepoint, ne lève jamais vers l'appelant, journal sans PII) ; `statistiquesEssais(now, jours)`.
- Modifications : `offrirJours` (origine), `onboarding.ts` (`TerminerResultat.essai`), `vitrines.ts` (transaction + `essai`), `prolongation.ts` (D11), `notifications/abonnements.ts` et `pertinence.ts`, `email-outbox.ts`, contenus d'e-mails, `abonnements.ts` (`getTarifs`), admin (`utilisateurs`, vue d'ensemble), resources.
- Textes : jour 2 « Ajoutez vos services à votre vitrine » ; jour 7 « Votre vitrine cette semaine » (visites et clics, ou « Partagez votre adresse… » si 0) ; J-3 « Votre essai se termine dans 3 jours » ; J0 « Votre essai se termine aujourd'hui » (retour au plan gratuit, grâce, lien de renouvellement). Vouvoiement ; jamais « espace/bloc/module/widget/section ».

## 5. Lots (périmètres disjoints)

- **Thread principal, avant les agents** : `shared/essai.ts`, `shared/admin-a2.ts`, `shared/admin.ts`, `shared/schemas/admin-versions.ts`, `shared/jobs.ts`, `shared/notifications.ts`, DTO d'abonnement, schéma de réponse de `terminer`, schéma de la vue d'ensemble admin.
- **database** : migration 0036, snapshot, journal, `shared/db/schema.ts`.
- **backend** : tous les services et routes ci-dessus.
- **frontend** : écran de fin d'inscription (un seul message), carte Abonnement, `/tarifs`, landing, admin (origine « Essai », éditeur de version « Essai » avec `USwitch`, carte des conversions).
- **tests** : voir §6 ; mises à jour des tests existants qui figent les listes (`a2-formats`, `migration-0029`, `migration-0020`, `migration-0032`, seed-v1, snapshots d'e-mails, `onboarding.test.ts`, planificateur de rappels).

## 6. Critères d'acceptation (CA-E1-01 à 34)

[PG] = vraie base ; on ne mocke que l'horloge et le transport des e-mails.

- 01 [PG] Compte e-mail réel, v1 active : `terminer` crée `abonnements` (`essai`, `payant`, +14 j), `essais` (v1), `essais_empreintes` (email) ; réponse 201 `essai.dureeJours = 14`.
- 02 [PG] 5 services proposés, plan gratuit à 3 : les 5 sont insérés.
- 03 [PG] `terminer` rejoué : 200, `essai: null`, 1 ligne `essais`, 1 `abonnements`.
- 04 [PG] Deux `terminer` simultanés : une vitrine, un essai, un abonnement.
- 05 [PG] `terminer` et `POST /api/studio/vitrine` simultanés : l'un 409 `VITRINE_EXISTE`, une seule ligne `essais`.
- 06 [PG] Compte supprimé puis nouveau compte avec la même adresse (casse, espaces) : pas d'essai (`deja_consomme`).
- 07 [PG] Compte téléphone seul ayant eu un essai ; un autre compte vérifie le même numéro : pas d'essai.
- 08 [PG] Deux comptes avec le même numéro, simultanés : un seul essai, aucune empreinte orpheline.
- 09 [PG] Version `actif = false` : pas d'essai, rien de consommé.
- 10 [PG] v2 `dureeJours = 30` : nouvel essai +30 j ; un essai v1 en cours garde son échéance.
- 11 [U] Valeurs invalides (0, 91, `relanceStatistiquesJour = 14`, clé inconnue) refusées.
- 12 [U] `lireConfigEssai` : repli `ESSAI_DEFAUT` (`versionId = 'code'`) sur ligne invalide ou base illisible, sans lever.
- 13 [PG] Valeurs de la v1 seedée = `ESSAI_DEFAUT`.
- 14 [PG] Compte avec abonnement offert par l'admin : pas d'essai, échéance inchangée, rien de consommé.
- 15 [PG] Panne simulée dans le savepoint : vitrine et services créés, `essai: null`.
- 16 [PG] Outbox : `abonnement_essai_services` à J+2 9 h locale, `abonnement_essai_statistiques` à J+7, occurrence `ESSAI:<fin ISO>`, `transactionnel` ; pas de doublon à la replanification.
- 17 [U] Relances : `ESSAI_TERMINE` (origine paiement), `ENTITE_INTROUVABLE`, `RAPPEL_PERIME`.
- 18 [PG] « services » annulée (`CONTENU_DEJA_AJOUTE`) si réalisation ou service ajouté après la vitrine ; sinon envoyée.
- 19 [PG] Planificateur : essai, pas de rappel à J-7, rappels à J-3 et J0 ; abonnement payé : rappel à J-7 (non-régression).
- 20 [U] Contenu `abonnement_rappel` avec `essai: true` : objet « essai », lien présélectionnant la période la plus courte ; snapshots texte et HTML.
- 21 [U] Quatre textes sans mots interdits, vouvoiement.
- 22 [PG] Paiement pendant l'essai : `origine = paiement`, échéance depuis `max(now, fin d'essai)`, `converti_le` renseigné, non modifié à la 2ᵉ confirmation.
- 23 [PG] Compte converti puis supprimé : `essais.user_id` NULL, `converti_le` conservé, compté par `statistiquesEssais`.
- 24 [PG] UPDATE de `fin_le`, DELETE, ou `user_id` remplacé : 42501.
- 25 [PG] Routes admin avec un abonnement `essai` : 200, `origine = essai`, aucune 500.
- 26 [PG] Un essai n'est pas compté dans les revenus, les abonnés payants ni l'alerte « payant sans paiement ».
- 27 [PG] Admin réauthentifié : crée et active une version `essai` (journal `version.activer`) ; sans réauthentification : `REAUTH_REQUISE`.
- 28 [PG] Essai expiré (aucune grâce, même après 1 s) : `getPlanEffectif` = gratuit ; un abonnement payé expiré garde sa grâce (non-régression) ; services au-delà de 3 masqués publiquement, jamais supprimés.
- 29 [PG] Tarifs publics : `essai` suit `actif` (≤ 5 s).
- 30 [U] `empreinteEssai` : insensible à la casse et aux espaces ; deux secrets donnent deux empreintes ; e-mail temporaire et numéro non vérifié exclus.
- 31 [PG] CHECK : `essai` accepté, `Essai` refusé ; catégorie `essai` avec une autre clé refusée ; types d'outbox acceptés.
- 32 [E2E] Fin d'inscription : un seul message « 14 jours du plan payant… » ; carte Abonnement « Essai gratuit, se termine le … ».
- 33 [E2E] `/tarifs` et landing : mention visible, disparaît si `actif = false`.
- 34 [E2E] Admin : origine « Essai », conversions sur 30 jours.

## 7. Risques et inconnus

- **R1** `regression-checker` obligatoire sur `prolongation.ts`, `onboarding.ts`, `planifierRappelsAbonnement`.
- **R2** Résolu (D4) : secret dédié `ESSAI_EMPREINTE_SECRET`. Reste : le perdre ou le tourner rouvre les essais ; à conserver comme une clé de chiffrement.
- **R3** Résolu (D4bis) : pas de production, pas de rattrapage.
- **R4** Numéro ajouté après l'essai : non enregistré (crochet Better Auth possible).
- **R5** Résolu (D8) : `relationnel` avec désabonnement.
- **R6** Résolu (D9) : pas de grâce pour un essai.
- **R7** Paiement en ligne verrouillé (`a_valider`) : le lien de J0 mène à une page où l'on ne peut pas encore payer ; état de la page d'abonnement NON VÉRIFIÉ.
- **R8** Savepoint Drizzle imbriqué NON VÉRIFIÉ ; repli `SAVEPOINT` explicite.
- **NON VÉRIFIÉ** : forme de `server/resources/abonnement.ts`, DTO et carte Abonnement, écran de fin d'onboarding, route publique des tarifs, interface `adaptateurs/types.ts`, fichier de la vue d'ensemble admin, `shared/notifications.ts`, `seed-v1.test.ts`, listes figées de `migration-0020.test.ts`, présence de `essai.spec.ts` dans la CI, `getPlanEffectif` dans la transaction passée, réutilisation de `ABONNEMENT_RAPPEL_HEURE_LOCALE`.

## 8. Estimation (minutes)

Thread principal 30 · database 45 · backend 180 · frontend 120 · tests 180 · revues 60 · **total ≈ 10 h** de travail d'agents (en partie parallèle).
