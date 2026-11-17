# A2 — Utilisateurs, vitrines et assistants (spec architecte, tier critique)

**Objectif** : retrouver un compte, comprendre sa situation, agir avec traçabilité (suspendre, offrir, changer de plan, supprimer, dépublier, retirer un assistant).
**Pré-requis** : A1 (`requireSuperadmin`, `Audit.enregistrer(tx, entree)`, `exigerReauth` + `demanderCode`, schémas stricts `shared/schemas/admin.ts`, test de contrat de confidentialité). **Maquettes** : aucune.

## 1. CHALLENGE

- **Hypothèses implicites.** (a) « Publiée » = `vitrines.publiee_le IS NOT NULL`, recopié à la main dans au moins 11 points : `vitrines.ts:337`, `creneaux.ts:175`, `messages.ts:29`, `statistiques.ts:136`, `medias.ts:244`, `services.ts:426`, `realisations.ts:430`, `temoignages.ts:322`, `liens.ts:229`, `seo-sitemap.ts:33`, `ia/seo.ts:175`. Un prédicat « central » ne protège rien tant que ces points ne sont pas migrés : la migration est un livrable testé. (b) La suspension (`users.suspendu`, `schema.ts:43`) n'est lue par AUCUNE surface publique aujourd'hui. (c) Révoquer les jetons OAuth en base suffit : FAUX pour les JWT d'accès à ressource, qui n'ont pas de ligne (`schema.ts:1082`) et restent valables jusqu'à expiration. `verifierPlanPayant`/`resoudreVitrine` (`mcp/auth.ts`) doivent donc lire `users.suspendu` à chaque appel.
- **Angles morts.** Le bannissement bloque la connexion, pas une session déjà ouverte : le garde de session doit lire `suspendu` (emplacement à localiser, non vérifié). `requirePublicAgendaService` (`creneaux.ts:147`) ignore la suspension, or créneaux, réservation, demande et confirmation passent par lui. La suppression existante (`utilisateurs.ts:103`) exige la phrase `SUPPRIMER` et une session fraîche (`shared/compte.ts`) : inadaptée à l'admin. `emails_transactionnels` porte des CHECK sur `type` (`schema.ts:645`) : sans migration, les e-mails d'A2 sont refusés en base. Son unicité `(entite_type, entite_id, type, occurrence)` bloque une deuxième dépublication si l'occurrence est vide.
- **Meilleure approche.** (1) Un prédicat SQL unique `sqlVitrinePublique()` et une fonction TS pure `estVitrinePublique()`, branchés sur toutes les surfaces (§4). Un test d'énumération échoue si une lecture publique utilise `publiee_le` hors du module. (2) La dépublication admin pose `blocage_admin` et NE remet PAS `publiee_le` à NULL : la republication par l'admin rétablit tout sans repasser par l'onboarding. (3) La suspension ne touche que `users.suspendu` : la réactivation rend tout automatiquement. (4) « Offrir des jours » passe par un service dédié qui écrit `abonnements.expire_le`, jamais par une écriture directe depuis une route.
- **À retirer.** Plan intermédiaire (A5), édition du contenu de vitrine par l'admin, SMS, restauration de compte supprimé.
- **Périmètre réel.** La recherche globale (retirée d'A1) entre en A2. Le cache nginx de 10 s borne le masquage à **≤ 10 s**.

## 2. Décisions (défaut appliqué ; ⚠️ = à relire par l'utilisateur)

- **D-A2-01** Suspension = `users.suspendu=true`, `motif_suspension`, `suspension_fin` NULL. Dans la transaction : suppression des `sessions`, `oauth_access_tokens`, `oauth_refresh_tokens` et `oauth_consents` du compte. Aucune copie dans `vitrines`.
- **D-A2-02** Dépublication admin = `vitrines.blocage_admin=true` + `blocage_motif`, `publiee_le` conservée. Republier = `blocage_admin=false`. `publishVitrine` (`vitrines.ts:206`) lève `VITRINE_BLOQUEE_ADMIN` (409) avec motif et adresse de contact (`shared/brand.ts`). La dépublication par le professionnel (`publiee_le=NULL`) reste inchangée.
- **D-A2-03** Un seul prédicat de visibilité (§4).
- **D-A2-04** Offrir N jours : `base = max(maintenant, expire_le)` (`choisirBase`, `abonnements-regles.ts:37`), puis `expire_le = base + N × 24 h`. Africa/Douala n'a pas d'heure d'été, donc « exactement N jours » ; l'arrondi à minuit n'est pas appliqué. Sans ligne `abonnements` : INSERT `plan='payant'`, `origine='offert'`, `premiere_activation_le=maintenant`. Sinon UPDATE de `expire_le`, `origine` inchangée. Verrou `pg_advisory_xact_lock` sur `abonnement:<userId>` comme `prolonger` (`paiements/application.ts:141`).
- **D-A2-05** ⚠️ Changer le plan : `payant → gratuit` supprime la ligne `abonnements` (sans période de grâce ; les `paiements` restent). `gratuit → payant` exige `jours` (1–365) et crée la ligne avec `origine='admin'`.
- **D-A2-06** Idempotence (jours offerts, changement de plan) : en-tête `Idempotency-Key` (8–128 caractères) stocké dans `journal_admin.cle_idempotence` (index unique admin + clé). Rejeu avec le même corps : résultat enregistré renvoyé, aucun effet. Même clé, corps différent : 409 `IDEMPOTENCE_CONFLIT`.
- **D-A2-07** Réauthentification (`*`) : suspendre, dépublier, changer le plan, supprimer. Réactiver, offrir des jours, révoquer les sessions, retirer un assistant : motif seul.
- ⚠️ **D-A2-08** Suppression : extraire `supprimerCompteEtFichiers(userId)` de `utilisateurs.ts:103`. Le studio garde sa phrase et sa fraîcheur ; l'admin confirme en saisissant l'e-mail exact du compte, plus la réauthentification. Les `emails_transactionnels` `en_attente` d'entité `utilisateur` du compte sont annulés avant suppression. Aucun e-mail n'est envoyé au compte supprimé.
- ⚠️ **D-A2-09** Rappels visiteurs : les rappels déjà planifiés pour des rendez-vous confirmés partent. Aucune NOUVELLE planification pour un compte suspendu (`notifications/planification.ts`, requêtes des lignes 230 et 278 : filtre `users.suspendu=false`).
- **D-A2-10** Côté visiteur, toute écriture et toute lecture de confirmation renvoient 404 `VITRINE_INTROUVABLE`, comme pour une vitrine non publiée. Le visiteur ne voit jamais la raison.
- **D-A2-11** Recherche : `q` de 3 à 100 caractères. E-mail : égalité insensible à la casse. Téléphone : chiffres seuls comparés à `users.telephone`. Username : préfixe. Nom : contient (`ILIKE` échappé). 10 résultats par groupe (comptes, vitrines). Aucune recherche dans le contenu visiteur.
- **D-A2-12** Listes : pagination par décalage, `limite` défaut 25, maximum 100 ; tri en liste blanche (`cree_le`, `email`, `derniere_connexion`, `plan`).
- ⚠️ **D-A2-13** Le motif de suspension et de dépublication est affiché au professionnel (écran de connexion, bandeau studio, e-mail). Le motif ne contient jamais de donnée de visiteur.
- **D-A2-14** E-mails : 4 types nouveaux (`utilisateur_suspendu`, `utilisateur_reactive`, `utilisateur_jours_offerts`, `utilisateur_depubliee`), `entite_type='utilisateur'`, `entite_id=userId`, `occurrence` = id de l'entrée de journal (unique par action). La ligne d'outbox est insérée DANS la transaction (atomique) ; le job `send-transactional-email` l'envoie après commit. Vouvoiement, courts.
- **D-A2-15** Assistants : `retirer` cible un `oauth_consents.id` (révocation comme `revokeAssistant`, `assistants.ts:115`). « Retirer tous » ajoute la route `utilisateurs/[id]/retirer-assistants` (ajout hors liste du brief).

## 3. Modèle de données — migration 0029

Fichier : `server/db/migrations/0029_a2_utilisateurs_vitrines.sql` (A1 occupe 0028).

```sql
ALTER TABLE "vitrines" ADD COLUMN IF NOT EXISTS "blocage_admin" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "vitrines" ADD COLUMN IF NOT EXISTS "blocage_motif" text;--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_blocage_check" CHECK (
  ("blocage_admin" = false AND "blocage_motif" IS NULL)
  OR ("blocage_admin" = true AND char_length(btrim("blocage_motif")) BETWEEN 5 AND 500));--> statement-breakpoint
ALTER TABLE "abonnements" ADD COLUMN IF NOT EXISTS "origine" text NOT NULL DEFAULT 'paiement';--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_origine_check"
  CHECK ("origine" IN ('paiement','offert','admin'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT IF EXISTS "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("type" IN (
  'reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee',
  'reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle',
  'demande_visiteur_recue','message_professionnel_nouvelle','reservation_visiteur_rappel',
  'utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel','paiement_confirme',
  'utilisateur_suspendu','utilisateur_reactive','utilisateur_jours_offerts','utilisateur_depubliee'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_suspendu_idx" ON "users" ("suspendu") WHERE "suspendu";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_cree_le_idx" ON "users" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_telephone_idx" ON "users" ("telephone") WHERE "telephone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vitrines_blocage_idx" ON "vitrines" ("blocage_admin") WHERE "blocage_admin";
-- ROLLBACK MANUEL (ordre inverse ; exporter les blocages avant, ils seront perdus) :
-- DROP INDEX IF EXISTS "vitrines_blocage_idx", "users_telephone_idx", "users_cree_le_idx", "users_suspendu_idx";
-- DELETE FROM "emails_transactionnels" WHERE "type" LIKE 'utilisateur_%' AND "type" IN ('utilisateur_suspendu','utilisateur_reactive','utilisateur_jours_offerts','utilisateur_depubliee');
-- ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check"; (puis ré-ajouter les 13 types d'origine)
-- ALTER TABLE "abonnements" DROP CONSTRAINT "abonnements_origine_check"; ALTER TABLE "abonnements" DROP COLUMN "origine";
-- ALTER TABLE "vitrines" DROP CONSTRAINT "vitrines_blocage_check"; ALTER TABLE "vitrines" DROP COLUMN "blocage_motif", DROP COLUMN "blocage_admin";
```

Schéma Drizzle (`shared/db/schema.ts`) : `blocageAdmin`, `blocageMotif` sur `vitrines` ; `origine` sur `abonnements` ; index correspondants ; liste `emails_transactionnels_type_check` recopiée. Le `users.suspendu` existe déjà (A1, migration 0028). Vérifier la présence des index `oauth_*` sur `user_id` avant d'en ajouter.

## 4. Prédicat central de visibilité

```ts
// server/services/visibilite.ts (SQL)
export function sqlVitrinePublique(v: typeof vitrines = vitrines): SQL
// = v.publiee_le IS NOT NULL AND v.blocage_admin = false
//   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.user_id AND u.suspendu)

export async function requireVitrinePublique(executor: Executor, rawUsername: string): Promise<VitrinePublique>
// 404 VITRINE_INTROUVABLE si absente, non publiée, bloquée ou suspendue. Remplace les `isNotNull(publieeLe)` ci-dessus.

// shared/admin-visibilite.ts (pur, testé sans base)
export function estVitrinePublique(v: { publieeLe: Date | null, blocageAdmin: boolean }, proprietaire: { suspendu: boolean }): boolean
```

**Surfaces à brancher (liste exhaustive vérifiée)**
- Lecture publique : `vitrines.ts:333` et `:360` ; `services.ts:426` et `:440` ; `realisations.ts:430` et `:444` ; `temoignages.ts:322` ; `liens.ts:229` ; `creneaux.ts:163-175` (`requirePublicAgendaService`, donc `creneaux/index.get.ts`) ; `reservations.ts:282-296` (confirmation et `confirmation/agenda.ics.get.ts`) ; `medias.ts:244` (photo servie).
- Écritures visiteur : `reservations/index.post.ts` (`reservations.ts:85`) ; `demandes/index.post.ts` (`demandes.ts:34`) ; `messages/index.post.ts` (`messages.ts:29`) ; `liens/[slug]/clic.post.ts` (`liens.ts:241`) ; `vue.post.ts` (`statistiques.ts:133-136`). Le démarrage de paiement visiteur n'existe pas : K-PAY sert à l'abonnement du professionnel. À revérifier si cela change.
- SEO : `seo-sitemap.ts:33` et la route `/api/__sitemap__/vitrines` ; `ia/seo.ts:175` (ne rien générer pour une vitrine masquée).
- MCP : `mcp/auth.ts` (`resoudreVitrine`, `résoudrePortées`, `verifierPlanPayant`) lit `users.suspendu` ; `mcp/http.ts` vérifie avant chaque outil.
- Connexions : Better Auth (`banned` à la connexion) + garde de session du studio et de l'admin (`suspendu` relu à chaque requête).
- Jobs : `notifications/planification.ts` (nouvelles planifications exclues des suspendus, D-A2-09).
- Studio : `publishVitrine` (`vitrines.ts:206`).

## 5. Backend

**Partagés, à créer AVANT les agents** : `shared/admin-a2.ts` (codes d'erreur, actions journal), `shared/schemas/admin-a2.ts` (Zod strict : entrées et sorties), `shared/admin-visibilite.ts`, ajouts dans `shared/admin.ts` (`ADMIN_ACTIONS` A2), `shared/jobs.ts` (`TRANSACTIONAL_EMAIL_TYPES` +4).

**Services** (aucun accès à l'événement H3) :
- `server/services/visibilite.ts` : `sqlVitrinePublique`, `requireVitrinePublique`.
- `server/services/admin/utilisateurs.ts` : `listerUtilisateurs(filtres, pagination)`, `getFicheUtilisateur(id)`, `suspendre(adminId, id, motif, ip)`, `reactiver(...)`, `offrirJours(adminId, id, jours, cle, motif, ip)`, `changerPlan(adminId, id, plan, jours|null, cle, motif, ip)`, `revoquerSessions(...)`, `retirerAssistants(...)`, `supprimer(adminId, id, emailSaisi, motif, ip)`.
- `server/services/admin/vitrines.ts` : `listerVitrines(filtres, pagination)`, `getFicheVitrine(id)`, `depublier(...)`, `republier(...)`.
- `server/services/admin/recherche.ts` : `rechercher(q)`.
- `server/services/admin/assistants.ts` : `listerAssistants(utilisateurId)`, `retirerAssistant(adminId, consentementId, motif, ip)`.
- `server/services/abonnements-offrir.ts` : `offrirJours(tx, userId, jours, now)` (D-A2-04).
- Modifiés : `utilisateurs.ts` (`supprimerCompteEtFichiers`), `vitrines.ts` (`publishVitrine`).

Chaque écriture : une transaction, verrou, `Audit.enregistrer(tx, entree)` ; effets externes (e-mails) dans la même transaction sous forme de ligne d'outbox ; rien d'autre après commit que le job.

**Routes** (fines : valider, appeler, répondre) :
`GET /api/admin/recherche` · `GET /api/admin/utilisateurs` · `GET /api/admin/utilisateurs/[id]` · `POST …/[id]/suspendre` * · `POST …/[id]/reactiver` · `POST …/[id]/offrir-jours` (Idempotency-Key) · `POST …/[id]/changer-plan` * (Idempotency-Key) · `POST …/[id]/revoquer-sessions` · `POST …/[id]/retirer-assistants` · `POST …/[id]/supprimer` * · `GET /api/admin/vitrines` · `GET /api/admin/vitrines/[id]` · `POST …/[id]/depublier` * · `POST …/[id]/republier` · `GET /api/admin/assistants` (`?utilisateurId=`) · `POST /api/admin/assistants/[id]/retirer`.
\* = en-tête `x-admin-reauth` (A1, `ADMIN_REAUTH_ENTETE`). Sans lui : 428 `REAUTH_REQUISE`.

**Entrée** : `z.strictObject({ motif: z.string().trim().min(5).max(500) })` (bornes = `ADMIN_MOTIF_MIN/MAX`) ; `id` : texte ≤ 64 ; `jours` : entier 1–365 ; `plan` : `payant | gratuit`.

**Sortie (liste blanche, schémas stricts, jamais de spread de ligne)** :
- `UtilisateurLigne` : `id, nom, email, username|null, plan, etat ('gratuit'|'actif'|'grace'), suspendu, inscritLe, derniereConnexion, vitrine: {publiee, bloquee}|null`.
- `UtilisateurFiche` : ligne + `telephone` (celui du professionnel), `pays, devise, fuseau`, `abonnement {origine, expireLe, premiereActivationLe}|null`, `compteurs {services, realisations, temoignages, liens}`, `activite30j {vues, reservations, demandes, messages}` (nombres seulement), `iaMois`, `sessionsActives {id, creeLe, expireLe}[]`, `assistants {id, client, portees, dernierUsage}[]`.
- `VitrineLigne` / `VitrineFiche` : username, nom, métier, plan, publiee, bloquee, motif de blocage, compteurs. Jamais réservations, demandes, messages ni témoignages en contenu.
- Interdits en sortie : nom, e-mail ou téléphone d'un VISITEUR ; motif, message, contenu de réservation ou de demande ; `ip` ; jetons.

**Journal** (`cible_type` : `utilisateur`, `vitrine`, `assistant`) :
| action | avant | après |
|---|---|---|
| `utilisateur.suspendre` | `{suspendu:false}` | `{suspendu:true}` |
| `utilisateur.reactiver` | `{suspendu:true}` | `{suspendu:false}` |
| `utilisateur.offrir_jours` | `{expire_le, origine}` | `{expire_le, origine:'offert'}` |
| `utilisateur.changer_plan` | `{plan}` | `{plan}` |
| `utilisateur.revoquer_sessions` | — | `{sessions:n}` |
| `utilisateur.retirer_assistants` | — | `{assistants:n}` |
| `utilisateur.supprimer` | `{suspendu}` | `{supprime:true}` |
| `vitrine.depublier` / `vitrine.republier` | `{blocage_admin}` | `{blocage_admin}` |
| `assistant.retirer` | — | `{client_id_present:true}` |
Les clés n'utilisent jamais `code`, `note`, `message`, `ip` ou `cle` (`CLES_AUDIT_INTERDITES`).

## 6. Frontend

- `app/pages/admin/utilisateurs/index.vue` : recherche (`UInput`, anti-rebond 300 ms, minimum 3 caractères), filtres (`USelect` : plan, statut, vitrine publiée / bloquée / aucune, plage d'inscription), `UTable` à tri par en-tête, `UPagination` côté serveur. Filtres et page dans l'URL.
- Fiche : `USlideover` à droite (plein écran sous 768 px), ouverture par `?fiche=<id>` (lien partageable, retour arrière).
- `app/pages/admin/vitrines/index.vue` : même motif.
- Barre du haut : recherche globale (`UCommandPalette` si disponible dans la version installée, sinon `UInput` + liste groupée). Résultats groupés, 10 par groupe, ouverture de la fiche.
- Confirmation : `UModal` avec `UTextarea` du motif (5–500 caractères, compteur). Bouton destructif `aria-disabled` tant que le motif est invalide, avec aide visible. Suppression : saisie de l'e-mail exact. Réauthentification : étape « demander le code » puis champ 6 chiffres (composant A1).
- Étiquettes : Suspendu, Gratuit, Actif, Grâce, Publiée, Bloquée (tokens seulement). États : chargement, vide, erreur avec « Réessayer ».
- Studio (`app/pages/studio/**`) : quand `blocage_admin` est vrai, un bandeau unique (motif + moyen de contacter) remplace le bouton « Publier », désactivé. Connexion : compte suspendu → message avec motif et contact, sans formulaire de code.

## 7. Critères de réception (Given / When / Then)

- **CA01** Given un compte actif avec vitrine publiée et une session ouverte, When l'admin suspend avec motif et réauthentification, Then les sessions, jetons OAuth et consentements sont supprimés, la connexion est refusée avec le motif, et la requête de la session existante renvoie 401.
- **CA02** Given un compte suspendu, When un visiteur appelle la page, `creneaux`, `reservations`, `demandes`, `messages`, `liens/clic`, `vue` ou `confirmation`, Then 404 `VITRINE_INTROUVABLE` et aucune ligne écrite ; la vitrine est absente du sitemap.
- **CA03** Given un jeton MCP émis avant la suspension, When l'assistant appelle un outil, Then refus (403) même si le jeton n'est pas expiré.
- **CA04** Given une suspension, When la réactivation est faite, Then la connexion, la vitrine publique et les écritures visiteur reviennent sans autre action.
- **CA05** Given une vitrine publiée, When l'admin dépublie avec motif, Then la page publique renvoie 404 dans les 10 s, un e-mail `utilisateur_depubliee` est envoyé avec le motif, et `publishVitrine` répond 409 `VITRINE_BLOQUEE_ADMIN` tant que `blocage_admin` est vrai ; après republication admin, le studio peut publier à nouveau.
- **CA06** Given un compte avec `expire_le` = T, When l'admin offre 30 jours avec la clé K, Then `expire_le` = T + 30 jours exactement ; When la même requête est rejouée avec K, Then la réponse est identique et `expire_le` est inchangé.
- **CA07** Given un compte gratuit, When l'admin offre 30 jours, Then une ligne `abonnements` `origine='offert'` existe avec `expire_le` = maintenant + 30 jours.
- **CA08** Given une suppression confirmée par l'e-mail exact, When elle s'exécute, Then le compte, la vitrine, les services, les médias (lignes et fichiers) disparaissent ; `paiements.user_id` vaut NULL ; le journal ne contient aucune donnée personnelle.
- **CA09** Given une recherche par e-mail, téléphone ou username, Then le compte est trouvé ; une requête de moins de 3 caractères renvoie 422.
- **CA10** Given une action d'écriture dont le journal échoue, Then l'action est annulée (aucun changement d'état, aucun e-mail).
- **CA11** Given toute réponse d'une route `/api/admin/**`, Then elle ne contient aucune clé hors liste blanche et aucune donnée de visiteur (test d'énumération).

## 8. Tests

- **Unitaires** (`tests/unit/admin-visibilite.test.ts`, `tests/unit/admin-offre.test.ts`) : table de vérité de `estVitrinePublique` ; calcul `max(now, expire)` ; schémas stricts (clé inconnue refusée) ; normalisation de recherche.
- **Intégration sur PostgreSQL réel** (`tests/integration/a2-*.test.ts`, base de test, aucun mock du repository) : migration 0029 aller et retour ; `sqlVitrinePublique` sur chaque surface de §4 ; journal atomique (échec forcé → rollback) ; idempotence (rejeu) ; suppression (images, `paiements` NULL) ; sessions et consentements révoqués.
- **Routes** : 200/401/403/404/422/428/409 pour chaque route ; `x-admin-reauth` absent → 428.
- **Confidentialité** : énumération de `server/api/admin/**` (A1) étendue aux nouvelles routes ; test interdisant `publiee_le` dans les lectures publiques hors `visibilite.ts`.
- **MCP** : jeton réel (JWT) puis suspension puis appel → refus.
- **E2E Playwright** (`e2e/admin-utilisateurs.spec.ts`) : suspension → visiteur 404 → réactivation ; dépublication → bandeau studio.
- Résultat de `pnpm test` avec sortie brute collée ; aucun `skip`.

## 9. Périmètres de fichiers disjoints

**Thread principal, AVANT les agents** : `shared/admin-a2.ts`, `shared/schemas/admin-a2.ts`, `shared/admin-visibilite.ts`, ajouts `shared/admin.ts` et `shared/jobs.ts`.

- **database** : `server/db/migrations/0029_a2_utilisateurs_vitrines.sql`, `shared/db/schema.ts` (seulement `blocageAdmin`, `blocageMotif`, `origine`, index, liste de types). Attendre la fusion de la migration A1 0028 (`schema.ts` est déjà modifié par A1).
- **backend** : `server/services/visibilite.ts`, `server/services/admin/*.ts`, `server/services/abonnements-offrir.ts`, `server/services/utilisateurs.ts`, `server/services/vitrines.ts` (seulement `publishVitrine`), `server/services/emails/contenus.ts` et `notifications-contenus.ts`, `server/api/admin/**`. Surfaces de §4 : `server/services/{creneaux,reservations,demandes,messages,liens,statistiques,medias,services,realisations,temoignages,seo-sitemap,notifications/planification}.ts`, `server/services/ia/seo.ts`, `server/mcp/{auth,http}.ts`, `server/api/public/[username]/**`, `server/api/__sitemap__/**`. Le backend ne touche PAS aux composants Vue.
- **frontend** : `app/pages/admin/**`, `app/components/admin/**`, `app/pages/connexion*` (message de suspension), `app/pages/studio/**` et `app/components/studio/**` (bandeau de blocage uniquement).
- **tester** : `tests/**`, `e2e/**`. Aucun fichier de production.
- Ordre : partagés, puis database, puis backend et frontend en parallèle, puis tester, puis reviewer (diff) et regression-checker (`publishVitrine`, `planification.ts`, `deleteAccount`, sitemap, MCP).

## 10. Risques et questions ouvertes

1. **Course** : une réservation en cours de transaction au moment de la suspension peut aboutir. Fenêtre de quelques millisecondes ; accepté. Alternative : `FOR SHARE` sur la ligne `users` dans la transaction visiteur (⚠️ à trancher si l'utilisateur veut zéro fenêtre).
2. **Délai** : masquage ≤ 10 s (cache nginx). Un JWT MCP déjà en cours d'appel peut finir sa requête.
3. **Recherche** : `ILIKE` sans index trigramme. Suffisant à ce volume ; `pg_trgm` à ajouter au-delà de quelques dizaines de milliers de comptes.
4. ⚠️ **Rappels visiteurs** d'une vitrine suspendue (D-A2-09) : envoyés pour les rendez-vous confirmés, sans nouvelle planification.
5. ⚠️ **Motif visible** au professionnel (D-A2-13).
6. ⚠️ **Passer en gratuit** supprime la ligne d'abonnement (D-A2-05).
7. ⚠️ **Réauthentification** pour suspendre et dépublier, plus stricte que le brief (D-A2-07).
8. **Non vérifié** : emplacement du garde de session (`requireUserSession`), existence des index `oauth_*` sur `user_id`, présence des e-mails d'entité `utilisateur` dans l'outbox à la suppression. Le backend doit les vérifier avant d'écrire.
9. **Refactor de `deleteAccount`** : comportement studio inchangé, couvert par regression-checker.
10. **Dépendance A1** : `journal_admin`, `exigerReauth`, `ADMIN_REAUTH_ENTETE` fusionnés avant A2.
