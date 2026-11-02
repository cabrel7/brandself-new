# Spec S9 : notifications et rétention

Branche `sprint/s9-notifications`. Tier **critique** pour ce sprint (données personnelles, envois à des tiers) : sécurité renforcée, tests de régression, cartographie obligatoire. Décisions numérotées à la suite du journal (S8 s'arrête à #80).

## Sources lues

SPRINTS.md (BLOC COMMUN, S9, S10 pour la frontière), CLAUDE.md, PROJECT_STATE.md (en entier), PROJECT_CONTEXT.md §8, §9 et §11, docs/specs/S8-onboarding-ia.md (format, lots, #68 à #80). Code : `shared/db/schema.ts` (users, vitrines, liens, reservations, demandes, messages, emails_transactionnels), `shared/jobs.ts`, `worker/index.ts`, `server/jobs/{email-outbox,ia,queues}.ts`, `server/services/{email-outbox,reservations,vitrines,vitrines-regles,utilisateurs}.ts`, `server/services/emails/{contenus,transport}.ts`, `server/auth.config.ts`, `shared/schemas/moi.ts`, `shared/dto/utilisateur.ts`, `app/utils/prochaine-etape.ts`, `app/components/vitrine/EnLigne.vue`, `app/pages/studio/{index,compte}.vue`, `app/pages/studio/liens/index.vue`, `app/composables/useReservation.ts`, `nuxt.config.ts`. Maquettes : `Studio · Compte`, `Studio`, `Inscription · En ligne`, `Réservation · Mobile`.

---

## CHALLENGE

**Hypothèses implicites du brief**
- « Le formulaire de contact est à faire » : **faux**. S7-bis l'a livré (route publique, table `messages`, champ piège, limiteurs, e-mail `message_professionnel_nouvelle`, liste studio et marquage « lu », ligne Messages sur l'écran Vitrine). S9 n'y touche pas, sauf pour les critères de réception (preuve de l'envoi).
- « L'interrupteur du rappel visiteur existe » : **à moitié**. La colonne `reservations.rappel_email` et le champ Zod existent, mais le formulaire envoie `rappelEmail: false` en dur (`useReservation.ts:67`) et n'affiche aucun interrupteur. La maquette `Réservation · Mobile` montre pourtant « Recevoir un rappel par email · 24 heures avant le rendez-vous ». Le rappel ne pourra jamais partir tant que cet interrupteur manque : il entre dans S9.
- « Le résumé donne les visites et les clics » : **aucune donnée fiable**. Il n'existe aucun suivi des visites (S11). `liens.clics_semaine` ne compte que les clics de la page de liens et repart à zéro au premier clic d'une nouvelle semaine ISO UTC : le lundi à 8 h, le chiffre de la semaine écoulée est soit juste, soit déjà effacé. Et l'accueil du studio affiche déjà `statistiques7j` à `0/0/0` en dur (`server/resources/vitrine.ts:49`) : la maquette montre « 128 visites », l'application dit 0. C'est un affichage trompeur qui existe déjà.
- « Envoyer par Resend » : l'expéditeur est codé en dur à `onboarding@resend.dev` (`transport.ts:4`). Cette adresse de test de Resend **n'envoie qu'à l'adresse du titulaire du compte Resend**. En production, aucun rappel ni résumé n'arriverait aux visiteurs ni aux professionnels. C'est bloquant pour la production. Le correctif tient dans ce sprint (adresse en configuration) ; le domaine vérifié reste à fournir.

**Angles morts**
- **Unicité de l'outbox** : la clé `(entite_type, entite_id, type)` interdit tout e-mail récurrent (un résumé par semaine, un rappel par jour) et tout rappel replanifié. Il faut ajouter une clé d'occurrence.
- **L'outbox sait déjà planifier** : `prochaine_tentative` + l'interrogation toutes les 5 s suffisent pour un envoi différé. En revanche, `claimOutbox` ne vérifie pas `prochaine_tentative <= now` : si quelqu'un mettait la ligne en file directement, elle partirait trop tôt. Ce garde-fou est à ajouter.
- **Better Auth** : `email_hebdo`, `fuseau`, `locale`, `devise` et `nom` sont déclarés en `additionalFields` sans `input: false`. Le point d'entrée `/api/auth/update-user` permet donc de les modifier **sans passer par Zod** : fuseau invalide, ou fuseau de l'utilisateur désynchronisé de celui de la vitrine (la synchronisation n'existe que dans `updateMe`). Un fuseau invalide en base ferait échouer un `AT TIME ZONE` SQL pour tous les utilisateurs : la planification doit s'en protéger, et cette porte doit être fermée.
- **Désabonnement par GET** : les scanners de liens des messageries (Outlook SafeLinks, antivirus) ouvrent les liens et désabonneraient l'utilisateur à sa place. Il faut un GET sans effet et un POST en un clic (RFC 8058).
- **Mot réservé** : la page `/desabonnement` entre en collision avec `[username]`. Il faut l'ajouter à `shared/reserved.ts`.
- **Débit Resend** : le lundi à 8 h, tous les comptes d'un même fuseau reçoivent leur résumé au même moment. Resend limite le nombre de requêtes par seconde, et l'offre gratuite plafonne à environ 100 e-mails par jour. Sans limiteur côté worker, on obtient des 429, puis un échec définitif au bout de 5 tentatives (2+4+8+16 s).
- **Liens absolus dans les e-mails** : le worker n'a pas accès à `useRuntimeConfig`. Il faut une URL publique du site validée dans `shared/env.ts`.
- **Compte créé par téléphone** (e-mail temporaire) sans `email_contact` : il n'y a aucun destinataire, donc on ne planifie rien plutôt que d'échouer 5 fois.

**Meilleure approche (retenue)**
- **Pas de nouvel ordonnanceur et pas de jobs BullMQ différés.** L'outbox existante devient le planificateur unique : une ligne = un e-mail, `prochaine_tentative` = heure d'envoi, `occurrence` = clé d'idempotence métier, clé Resend = id de la ligne. Les rappels visiteur sont insérés **dans la transaction de confirmation**. Le résumé et le rappel du jour sont insérés par un job répété toutes les 5 min (`notifications-planifier`, ordonnanceur BullMQ idempotent, même patron que `ia-purger`). Un seul chemin d'envoi, déjà durci (verrou `FOR UPDATE`, bail, essais limités, codes d'erreur sans données personnelles).
- **Revalidation au moment de l'envoi** : statut de la réservation, préférence, fenêtre de rattrapage, existence du compte. Ce qui n'est plus pertinent passe en `annule` avec un code, sans aucun envoi. C'est ce qui règle à la fois l'annulation, le rendez-vous passé, la panne du worker et le compte supprimé.
- Calcul des fuseaux **en TypeScript avec Temporal** (déjà adopté en S7), fuseau par fuseau distinct : changements d'heure gérés, fuseau invalide écarté sans bloquer les autres, testable avec une horloge injectée.

**À retirer ou simplifier**
- Visites et clics dans le résumé : **retirés jusqu'à S11** (le contrat prévoit `visites: null`, `clics: null`, et chaque ligne nulle est omise). À la place : réservations reçues, demandes, messages et rendez-vous à venir, des chiffres exacts et vérifiables.
- Pas de table de préférences : deux booléens typés sur `users` (`email_hebdo` existe déjà, on ajoute `email_rappel_jour`).
- Pas de table pour les jetons de désabonnement : HMAC sans état.
- Pas de canal de partage enregistré (minimisation) : seulement la date du premier partage.

**Périmètre réel vs demandé**
- En plus du brief : interrupteur du rappel sur le formulaire de réservation, adresse d'expéditeur configurable, `input: false` sur Better Auth, mot réservé, limiteur Resend, purge de l'outbox, préférence « rendez-vous du jour » (un e-mail quotidien sans moyen de l'arrêter n'est pas acceptable).
- Retiré : re-spécifier le contact et les messages (déjà livrés).

**Changements par rapport au brief littéral** : résumé sans visites ni clics (#87) ; nouvelle préférence `email_rappel_jour` (#86) ; interrupteur visiteur ajouté (#85) ; expéditeur configurable (#91) ; désabonnement en deux temps, GET sans effet et POST en un clic (#89).

---

## 0. État des lieux

| Élément | Existant (preuve) | À faire en S9 |
|---|---|---|
| Contact public + messages + marquage « lu » | S7-bis : `server/api/public/[username]/messages/index.post.ts`, `server/services/messages.ts`, `app/pages/studio/messages.vue`, ligne « Messages » de `studio/index.vue` | Rien (CA de réception seulement) |
| E-mail « nouveau message » au professionnel | `message_professionnel_nouvelle` inséré dans la transaction (`messages.ts:46`), contenu dans `contenus.ts` | Rien |
| Outbox | table `emails_transactionnels`, `processTransactionalEmail` (verrou, bail 60 s, 5 essais, clé Resend `brandself-email-<id>`), dispatcher toutes les 5 s dans `worker/index.ts` | `occurrence`, `categorie`, statut `annule`, 3 types, entité `utilisateur`, garde-fou sur `prochaine_tentative`, revalidation, en-têtes |
| Rappel visiteur 24 h | colonne `rappel_email` (défaut false), Zod `rappelEmail` ; **UI absente, valeur false en dur** | Interrupteur sur le formulaire, insertion à la confirmation, annulation, contenu |
| Rappel matinal du professionnel | rien | Planification, préférence, contenu |
| Résumé hebdomadaire | `users.email_hebdo` (défaut true) en base et dans Better Auth ; absent du DTO, du Zod `/moi` et de Compte | Tout, sauf la colonne |
| Visites | **aucune** ; `statistiques7j` = 0 en dur | Rien (S11) ; question ouverte Q3 |
| Clics | `liens.clics_semaine`/`semaine_debut` (non fiables pour une période écoulée) | Rien (S11) |
| Prochaine étape | `NEXT_STEPS` (4), `computeNextStep`, `summarize`, `ProchaineEtape.vue`, `app/utils/prochaine-etape.ts` | Étape `partager`, ignorer (mémorisé), `GET /api/studio/prochaine-etape` |
| Aide au partage | `EnLigne.vue` : copie + WhatsApp (« Découvrez ma vitrine : … ») ; page Liens : partage natif + QR (`nuxt-qrcode`) de la page de liens | Message prêt (WhatsApp, LinkedIn, copie) + QR de la vitrine, depuis En ligne et l'accueil du studio |
| Planification répétée | `planifierPurge` (`upsertJobScheduler`, cron + tz) | `notifications-planifier` (5 min), `notifications-purger` (quotidien) |
| Fuseaux | `@js-temporal/polyfill` (`creneaux.ts`), `isValidTimeZone` (`shared/fuseau.ts`), synchronisation users → vitrines dans `updateMe` | Fenêtres locales, semaine ISO, journée locale |
| Désabonnement | rien | Jeton HMAC, page, routes, en-têtes List-Unsubscribe |

---

## 1. Décisions par défaut (#81 à #102)

| # | Sujet | Décision |
|---|---|---|
| 81 | Planificateur | L'outbox `emails_transactionnels` est le seul planificateur d'envois (`prochaine_tentative` = heure d'envoi). Aucun job BullMQ différé par e-mail. Le dispatcher existant met en file les lignes arrivées à échéance (job `send-transactional-email`, jobId déterministe). |
| 82 | Idempotence | Nouvelle colonne `occurrence` ; unicité `(entite_type, entite_id, type, occurrence)`. Rappel visiteur : `debut` en ISO UTC ; rappel du jour : date locale `AAAA-MM-JJ` ; résumé : semaine ISO de la période (`2026-W44`) ; types existants : `''`. Clé Resend inchangée (`brandself-email-<id>`). Rejeu du job, deux workers ou deux passes : au plus un envoi. |
| 83 | Revalidation | Après le claim et avant tout envoi, `verifierPertinence(row, now)`. Si la ligne n'est plus pertinente : `statut='annule'` + `erreur_code`, pas d'envoi, pas de nouvel essai. Le claim refuse une ligne `en_attente` dont `prochaine_tentative > now` (résultat `pas_encore`). |
| 84 | Rappel visiteur | Seulement si la réservation est `confirmee` avec `rappel_email = true`. Heure = `debut − 24 h` (durée absolue). Inséré dans la transaction de confirmation **seulement si** l'heure prévue est au moins 6 h après l'instant présent (sinon l'e-mail de confirmation tient lieu de rappel). Annulation ou refus : ligne `en_attente` → `annule` dans la même transaction. À l'envoi : abandon si plus de 6 h de retard sur l'heure prévue ou s'il reste moins de 2 h avant le rendez-vous. |
| 85 | Interrupteur visiteur | `USwitch` ajouté au formulaire de réservation (maquette). **Désactivé par défaut** (écart avec la maquette, qui le montre activé : Q2). |
| 86 | Rendez-vous du jour | E-mail au professionnel à 7 h dans le fuseau `users.fuseau`, rattrapage jusqu'à 10 h. Liste les réservations `confirmee` et `en_attente` dont le début tombe dans la journée locale. Un seul par jour. Nouvelle préférence `users.email_rappel_jour` (défaut true). Classé **transactionnel** (il porte sur l'activité réelle du compte) mais désabonnable (List-Unsubscribe). |
| 87 | Résumé hebdomadaire | Lundi à 8 h (`users.fuseau`), rattrapage jusqu'à 14 h. Période : les 7 jours locaux précédents `[lundi−7 00:00, lundi 00:00)` (167, 168 ou 169 h selon l'heure d'été). Conditions : `email_hebdo`, vitrine publiée, destinataire réel. Contenu : réservations reçues, demandes, messages, rendez-vous confirmés de la semaine qui commence. **Ni visites ni clics avant S11** (`null`, ligne omise). Activité = réservations + demandes + messages > 0 ; sinon **une seule** suggestion (prochaine étape, ou suggestion par défaut). |
| 88 | Fréquence | Au plus **un** e-mail `relationnel` par semaine ISO locale du destinataire, vérifié sous verrou consultatif transactionnel par utilisateur (`pg_advisory_xact_lock(hashtext('relationnel:'||user_id))`). En S9, seul le résumé est relationnel. Un CHECK lie `categorie` au type. |
| 89 | Désabonnement | Jeton sans état `v1.<payload base64url>.<HMAC-SHA256 base64url>`, payload `{ u: userId, p: preference, e: expiration epoch s }`, valable 90 jours. Clé dérivée par HKDF-SHA256 de `NUXT_BETTER_AUTH_SECRET` (info `brandself-desabonnement-v1`), comparaison à temps constant. GET = aperçu sans effet ; POST = désabonnement (RFC 8058 `List-Unsubscribe=One-Click`, ou JSON `{ jeton }`). Idempotent ; ne réactive jamais. Limiteur IP **fail-open** (le droit d'opposition doit rester effectif même si Redis tombe). |
| 90 | Format et suivi | E-mails en texte seul (aucun HTML, donc aucun pixel possible). Le suivi des ouvertures et des clics de Resend doit rester désactivé sur le domaine (lot H). `List-Unsubscribe` et `List-Unsubscribe-Post` seulement sur le résumé et le rendez-vous du jour. Chaque e-mail se termine par une phrase « Vous recevez… » qui donne sa raison d'être. |
| 91 | Configuration | `EMAIL_EXPEDITEUR` (défaut en dev `Brandself <onboarding@resend.dev>`, **obligatoire en production**, domaine vérifié) et `NUXT_PUBLIC_SITE_URL` (URL, https en production) validés dans `shared/env.ts`, lus par le worker. |
| 92 | Débit | Limiteur BullMQ sur le worker `emails` : `EMAILS_DEBIT_MAX` par `EMAILS_DEBIT_FENETRE_MS` (2/s par défaut). Les 429 de Resend suivent le chemin d'essai existant. |
| 93 | Prochaine étape | Ordre photo → service → disponibilités → réalisation → **partager**. `partager` n'est proposé que si la vitrine est publiée et que `partagee_le` est NULL. Les étapes ignorées sont stockées dans `vitrines.etapes_ignorees text[]` (CHECK de sous-ensemble, comme `sections_masquees`) et sautées pour toujours ; on passe à la suivante. Toutes les étapes sont ignorables. |
| 94 | Partage | `vitrines.partagee_le` est posé (`COALESCE`, idempotent) par `POST /api/studio/vitrine/partage` au premier geste : WhatsApp, LinkedIn, copie du message ou téléchargement du QR. Le canal n'est pas stocké. |
| 95 | Message prêt | Fonction pure `buildShareMessage` (`shared/partage.ts`). WhatsApp : `https://wa.me/?text=`. LinkedIn : `share-offsite/?url=` (LinkedIn n'accepte que l'URL : le message est copié avant l'ouverture, avec une annonce). QR : composant `Qrcode` déjà installé, téléchargement en SVG (patron de la page Liens). |
| 96 | Better Auth | `input: false` sur `nom`, `locale`, `devise`, `fuseau`, `email_hebdo` (`server/auth.config.ts`). Les préférences ne s'écrivent que par `PUT /api/studio/moi` (Zod, synchronisation du fuseau). |
| 97 | Rétention | Les lignes d'outbox terminales (`envoye`, `echec`, `annule`) de plus de 90 jours sont supprimées par le job quotidien `notifications-purger`. Les lignes ne contiennent que des identifiants. |
| 98 | Fuseau invalide | Écarté par la planification ; journal `[notifications] fuseau invalide ignoré (n)` (nombre seulement). |
| 99 | Préférences au Compte | Nouvelle partie « E-mails » (absente de la maquette, écart signalé) entre « Vos informations » et « Connexion et sécurité » : 2 `USwitch`. |
| 100 | Minimisation | Rendez-vous du jour : heure, service, nom du visiteur (ni e-mail, ni téléphone, ni motif). Résumé : compteurs seulement. Rappel visiteur : récapitulatif sans motif ni téléphone. Aucun journal ne contient une adresse ou un contenu. |
| 101 | Destinataire absent | Compte avec e-mail temporaire et sans `email_contact` : rien n'est planifié pour lui (filtré à la planification, revérifié à l'envoi avec le code `DESTINATAIRE_ABSENT`). |
| 102 | Compte supprimé | Pour les 3 nouveaux types, une entité introuvable donne `annule` (`ENTITE_INTROUVABLE`) sans nouvel essai. Les types S7 gardent leur comportement (pas de régression ; voir les idées). |

---

## 2. Modèle de données : migration `0020_s9_notifications.sql`

Écrite à la main, avec `meta/0020_snapshot.json` et une entrée dans `meta/_journal.json`.

```sql
-- S9 (docs/specs/S9-notifications.md §2). Préférences, prochaine étape, outbox planifiée.
ALTER TABLE "users" ADD COLUMN "email_rappel_jour" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vitrines" ADD COLUMN "etapes_ignorees" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "vitrines" ADD COLUMN "partagee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vitrines" ADD CONSTRAINT "vitrines_etapes_ignorees_check"
  CHECK ("etapes_ignorees" <@ ARRAY['photo','service','disponibilites','realisation','partager']::text[]);--> statement-breakpoint

ALTER TABLE "emails_transactionnels" ADD COLUMN "occurrence" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD COLUMN "categorie" text DEFAULT 'transactionnel' NOT NULL;--> statement-breakpoint
DROP INDEX "emails_transactionnels_entite_evenement_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "emails_transactionnels_entite_evenement_unique"
  ON "emails_transactionnels" ("entite_type","entite_id","type","occurrence");--> statement-breakpoint
CREATE INDEX "emails_transactionnels_relationnel_idx"
  ON "emails_transactionnels" ("entite_id","created_at") WHERE "categorie" = 'relationnel';--> statement-breakpoint
CREATE INDEX "emails_transactionnels_terminal_idx"
  ON "emails_transactionnels" ("updated_at") WHERE "statut" IN ('envoye','echec','annule');--> statement-breakpoint

ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK ("type" IN (
  'reservation_professionnel_nouvelle','reservation_visiteur_recue','reservation_visiteur_confirmee',
  'reservation_visiteur_annulee','reservation_visiteur_refusee','demande_professionnel_nouvelle',
  'demande_visiteur_recue','message_professionnel_nouvelle',
  'reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check"
  CHECK ("entite_type" IN ('reservation','demande','message','utilisateur'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (
  ("entite_type" = 'reservation' AND "type" LIKE 'reservation_%')
  OR ("entite_type" = 'demande' AND "type" LIKE 'demande_%')
  OR ("entite_type" = 'message' AND "type" LIKE 'message_%')
  OR ("entite_type" = 'utilisateur' AND "type" LIKE 'utilisateur_%'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_statut_check";--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_statut_check"
  CHECK ("statut" IN ('en_attente','en_cours','envoye','echec','annule'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_categorie_check"
  CHECK ("categorie" IN ('transactionnel','relationnel'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_categorie_type_check"
  CHECK (("type" = 'utilisateur_resume_hebdo') = ("categorie" = 'relationnel'));--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_check"
  CHECK (char_length("occurrence") <= 32 AND "occurrence" ~ '^[0-9A-Z:.-]*$');--> statement-breakpoint
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_occurrence_requise_check"
  CHECK ("type" NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee')
         OR "occurrence" <> '');

-- ROLLBACK (manuel, dans l'ordre) :
-- DELETE FROM emails_transactionnels WHERE type IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee') OR statut = 'annule';
-- ALTER TABLE emails_transactionnels DROP CONSTRAINT emails_transactionnels_occurrence_requise_check, DROP CONSTRAINT emails_transactionnels_occurrence_check,
--   DROP CONSTRAINT emails_transactionnels_categorie_type_check, DROP CONSTRAINT emails_transactionnels_categorie_check;
-- Recréer les 4 CHECK (type, entite_type, entite_coherence, statut) avec leurs listes 0016/0017 ;
-- DROP INDEX emails_transactionnels_terminal_idx; DROP INDEX emails_transactionnels_relationnel_idx;
-- DROP INDEX emails_transactionnels_entite_evenement_unique;
-- CREATE UNIQUE INDEX emails_transactionnels_entite_evenement_unique ON emails_transactionnels (entite_type, entite_id, type);
-- ALTER TABLE emails_transactionnels DROP COLUMN categorie, DROP COLUMN occurrence;
-- ALTER TABLE vitrines DROP CONSTRAINT vitrines_etapes_ignorees_check, DROP COLUMN partagee_le, DROP COLUMN etapes_ignorees;
-- ALTER TABLE users DROP COLUMN email_rappel_jour;
-- DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash 0020>';
```

Notes :
- La recréation de l'index unique est sûre : les lignes existantes ont toutes `occurrence = ''`, donc aucun doublon.
- **Contrôle préalable** à placer en tête de la migration : `DO $$ BEGIN IF EXISTS (SELECT 1 FROM vitrines WHERE username = 'desabonnement') THEN RAISE EXCEPTION 'username réservé desabonnement déjà utilisé'; END IF; END $$;`
- Drizzle (`shared/db/schema.ts`) : `users.emailRappelJour` (propriété `email_rappel_jour`, comme `email_hebdo`) ; `vitrines.etapesIgnorees`, `vitrines.partageeLe` ; `emailsTransactionnels.occurrence`, `.categorie`. Index et CHECK reflétés, listes recopiées depuis `shared/jobs.ts` et `shared/notifications.ts` (commentaire « garder synchronisés »).
- Réservations : la plage `debut` est déjà indexée (`reservations_vitrine_id_debut_idx`), pas de nouvel index.

---

## 3. Contrats `shared/`

### 3.1 `shared/notifications.ts` (nouveau, pur) : toutes les valeurs réglables

```ts
export const RAPPEL_VISITEUR_AVANCE_HEURES = 24
export const RAPPEL_VISITEUR_ECART_MIN_HEURES = 6        // pas de rappel si l'heure prévue est trop proche de la confirmation
export const RAPPEL_VISITEUR_RATTRAPAGE_HEURES = 6
export const RAPPEL_VISITEUR_PREAVIS_MIN_HEURES = 2      // jamais de rappel à moins de 2 h du rendez-vous
export const RAPPEL_JOURNEE_HEURE_LOCALE = 7
export const RAPPEL_JOURNEE_RATTRAPAGE_HEURES = 3
export const RAPPEL_JOURNEE_STATUTS = ['confirmee', 'en_attente'] as const
export const RAPPEL_JOURNEE_MAX_LIGNES = 20
export const RESUME_JOUR_ISO = 1                          // lundi
export const RESUME_HEURE_LOCALE = 8
export const RESUME_RATTRAPAGE_HEURES = 6
export const RESUME_PERIODE_JOURS = 7
export const RELATIONNEL_MAX_PAR_SEMAINE = 1
export const NOTIFICATIONS_SCHEDULER_ID = 'notifications-planifier'
export const NOTIFICATIONS_TICK_CRON = '*/5 * * * *'
export const NOTIFICATIONS_TICK_TZ = 'UTC'
export const NOTIFICATIONS_PURGE_SCHEDULER_ID = 'notifications-purger'
export const NOTIFICATIONS_PURGE_CRON = '30 3 * * *'
export const NOTIFICATIONS_PURGE_TZ = 'UTC'
export const OUTBOX_RETENTION_JOURS = 90
export const PLANIFICATION_LOT_UTILISATEURS = 500
export const EMAILS_DEBIT_MAX = 2
export const EMAILS_DEBIT_FENETRE_MS = 1_000
export const DESABONNEMENT_JETON_VERSION = 'v1'
export const DESABONNEMENT_JETON_VALIDITE_JOURS = 90
export const DESABONNEMENT_HKDF_INFO = 'brandself-desabonnement-v1'
export const PREFERENCES_EMAIL = ['email_hebdo', 'email_rappel_jour'] as const
export type PreferenceEmail = (typeof PREFERENCES_EMAIL)[number]
export const EMAIL_CATEGORIES = ['transactionnel', 'relationnel'] as const
export type EmailCategorie = (typeof EMAIL_CATEGORIES)[number]
export const EMAIL_STATUTS = ['en_attente', 'en_cours', 'envoye', 'echec', 'annule'] as const
export const CODES_ANNULATION = ['RAPPEL_PERIME', 'RESERVATION_NON_CONFIRMEE', 'RESERVATION_ANNULEE',
  'PREFERENCE_DESACTIVEE', 'VITRINE_NON_PUBLIEE', 'ENTITE_INTROUVABLE', 'AUCUN_RENDEZ_VOUS',
  'DESTINATAIRE_ABSENT', 'PLAFOND_RELATIONNEL'] as const
```

Limiteur (dans `shared/limites.ts`, avec les autres) : `DESABONNEMENT_LIMITE_IP = 20`, `DESABONNEMENT_FENETRE_S = 60`.

### 3.2 `shared/jobs.ts`
- `TRANSACTIONAL_EMAIL_TYPES` reçoit `'reservation_visiteur_rappel'`, `'utilisateur_resume_hebdo'` et `'utilisateur_rappel_journee'`.
- `JOBS` reçoit `planifierNotifications: 'notifications-planifier'` et `purgerNotifications: 'notifications-purger'`.

### 3.3 `shared/vitrine.ts`
`NEXT_STEPS = ['photo','service','disponibilites','realisation','partager'] as const`.

### 3.4 `shared/prochaine-etape.ts` (nouveau, déplacé depuis `app/utils`)
`PROCHAINES_ETAPES: Record<NextStep, { titre, texte, chemin: string | null, action }>` (pour `partager` : `chemin: null`, l'action ouvre le panneau). Textes de `partager` : titre « Partagez votre vitrine », texte « Un message à vos contacts suffit souvent pour recevoir vos premières visites. », action « Partager ». `app/utils/prochaine-etape.ts` réexporte (`to` = `chemin`) pour que les consommateurs ne changent pas.

### 3.5 `shared/partage.ts` (nouveau, pur)
```ts
export const PARTAGE_WHATSAPP_BASE = 'https://wa.me/?text='
export const PARTAGE_LINKEDIN_BASE = 'https://www.linkedin.com/sharing/share-offsite/?url='
export interface ShareMessageInput { prenom: string, metier: string, url: string, reservable: boolean }
export function buildShareMessage(i: ShareMessageInput): string
// reservable : « Bonjour, je suis {prenom}, {metier}. Ma vitrine est en ligne : vous y trouverez mes services et vous pouvez réserver un rendez-vous directement. {url} »
// sinon      : « Bonjour, je suis {prenom}, {metier}. Ma vitrine est en ligne : vous y trouverez mes services et mes réalisations. {url} »
export function whatsappShareUrl(message: string): string
export function linkedinShareUrl(url: string): string
```
`metier` est passé en minuscule initiale, sauf s'il commence par un acronyme (2 majuscules).

### 3.6 Schémas Zod
- `shared/schemas/moi.ts` : `emailHebdo: z.boolean()` et `emailRappelJour: z.boolean()` ajoutés à l'objet `.partial().strict()`.
- `shared/schemas/notifications.ts` (nouveau) :
  - `schemaEtapeIgnorer = z.strictObject({ etape: z.enum(NEXT_STEPS) })` ;
  - `schemaJetonDesabonnement = z.string().min(20).max(512).regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)` ;
  - `schemaDesabonnementQuery = z.strictObject({ jeton: schemaJetonDesabonnement })` ;
  - `schemaDesabonnementCorps = z.union([z.strictObject({ jeton: schemaJetonDesabonnement }), z.strictObject({ 'List-Unsubscribe': z.literal('One-Click') })])`.

### 3.7 DTO
- `MoiDTO` reçoit `emailHebdo: boolean` et `emailRappelJour: boolean`.
- `shared/dto/notifications.ts` : `ProchaineEtapeDTO { etape: NextStep | null }`, `DesabonnementApercuDTO { preference: PreferenceEmail }`, `DesabonnementDTO { preference: PreferenceEmail, desabonne: true }`, `PartageDTO { partageeLe: string }`.

### 3.8 Erreurs (`shared/erreurs.ts` + `server/exceptions/http.ts`)
`JETON_INVALIDE` (404), `JETON_EXPIRE` (410), `VITRINE_NON_PUBLIEE` (422), `ETAPE_INCONNUE` (422 via Zod).

### 3.9 `shared/reserved.ts`
Ajout de `desabonnement`.

### 3.10 `shared/env.ts`
- `EMAIL_EXPEDITEUR: z.string().min(3).optional()`, obligatoire si `NODE_ENV=production` (`superRefine`, comme `RESEND_API_KEY`).
- `NUXT_PUBLIC_SITE_URL: z.url()`, https en production. À vérifier : s'il est déjà lu ailleurs (build S4), on le réutilise.

---

## 4. Planification et jobs

### 4.1 Files et jobs

| File | Job | Déclenchement | Rôle |
|---|---|---|---|
| `system` | `notifications-planifier` | `upsertJobScheduler(NOTIFICATIONS_SCHEDULER_ID, { pattern: '*/5 * * * *', tz: 'UTC' })` au démarrage du worker | `planifierNotifications(new Date())` : insère les lignes résumé et rendez-vous du jour |
| `system` | `notifications-purger` | cron `30 3 * * *` UTC | supprime les lignes terminales de plus de 90 jours |
| `emails` | `send-transactional-email` (existant) | dispatcher toutes les 5 s | envoie ; **nouveau** `limiter: { max: EMAILS_DEBIT_MAX, duration: EMAILS_DEBIT_FENETRE_MS }` |

Options des deux nouveaux jobs : `attempts: 1`, `removeOnComplete/Fail: true`. Un tick raté est rattrapé par le suivant (fenêtres de plusieurs heures). Fichier `server/jobs/notifications.ts` : `planifierNotificationsRepetees(queue)` et `planifierPurgeNotifications(queue)`, sur le patron de `planifierPurge`.

### 4.2 Rappel visiteur (dans la transaction, `server/services/reservations.ts`)

Dans `transitionOwnReservation` :
- **Confirmation** : si `item.rappelEmail` et `plannedAt = debut − 24 h` vérifie `plannedAt − now ≥ 6 h`, alors `insertScheduledEmailEvent(tx, { entiteType: 'reservation', entiteId, type: 'reservation_visiteur_rappel', occurrence: debut.toISOString(), prochaineTentative: plannedAt, categorie: 'transactionnel' })` avec `onConflictDoNothing`.
- **Annulation et refus** : `UPDATE emails_transactionnels SET statut='annule', erreur_code='RESERVATION_ANNULEE', updated_at=now WHERE entite_type='reservation' AND entite_id=$id AND type='reservation_visiteur_rappel' AND statut='en_attente'`.
- L'horloge est injectable : `transitionOwnReservation(..., now = new Date())`.

### 4.3 `planifierNotifications(now, deps)` (`server/services/notifications/planification.ts`)

1. `SELECT DISTINCT fuseau FROM users WHERE email_hebdo OR email_rappel_jour`.
2. Pour chaque fuseau : s'il est invalide (`isValidTimeZone`), on compte et on passe. Sinon `local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(tz)`. Fonctions pures dans `fenetres.ts` :
   - `dansFenetre(local, heure, rattrapageH)` ⇔ `heure*60 ≤ minutesDepuisMinuit < (heure + rattrapageH)*60` ;
   - `periodeResume(local) → { debut: Instant, fin: Instant, label: 'GGGG-Www' }` (`fin` = début du lundi local, `debut` = `fin` moins P7D en calendrier local) ;
   - `journeeLocale(local) → { debut, fin, label: 'AAAA-MM-JJ' }` ;
   - `debutSemaineIso(local) → Instant`.
3. **Résumé** (si `local.dayOfWeek === RESUME_JOUR_ISO` et dans la fenêtre) : candidats = `users JOIN vitrines` avec `fuseau = tz`, `email_hebdo`, `publiee_le IS NOT NULL`, destinataire résolvable (e-mail non temporaire, ou `email_contact` non vide), sans ligne `(utilisateur, id, resume, label)`. Traitement par lots de 500. Pour chaque candidat, une transaction : verrou consultatif, puis plafond (aucune ligne `categorie='relationnel' AND statut<>'annule' AND entite_id=user AND created_at >= debutSemaineIso`), puis insertion (`occurrence = label`, `prochaine_tentative = now`, `categorie='relationnel'`).
4. **Rendez-vous du jour** (si dans la fenêtre de 7 h) : utilisateurs `email_rappel_jour`, destinataire résolvable, avec `EXISTS` une réservation de leur vitrine en statut `RAPPEL_JOURNEE_STATUTS` et `debut ∈ [journee.debut, journee.fin)`. Insertion `occurrence = AAAA-MM-JJ`, `onConflictDoNothing`.
5. Retour `{ resumes, rappelsJour, fuseauxInvalides }`, journalisé en nombres seulement.

Un changement de fuseau en cours de semaine ou de journée ne double rien : l'étiquette est la même et l'unicité tranche (CA).

### 4.4 Revalidation à l'envoi (`server/services/notifications/pertinence.ts`)

| Type | Condition d'envoi (sinon `annule` + code) |
|---|---|
| `reservation_visiteur_rappel` | réservation présente (`ENTITE_INTROUVABLE`) ; `statut='confirmee'` (`RESERVATION_NON_CONFIRMEE`) ; `rappel_email` ; `debut.toISOString() === occurrence` (`RAPPEL_PERIME`) ; `now ≤ debut − 24 h + 6 h` et `now ≤ debut − 2 h` (`RAPPEL_PERIME`) |
| `utilisateur_resume_hebdo` | utilisateur présent ; `email_hebdo` (`PREFERENCE_DESACTIVEE`) ; vitrine publiée (`VITRINE_NON_PUBLIEE`) ; `now ≤ created_at + RESUME_RATTRAPAGE_HEURES` (`RAPPEL_PERIME`) ; destinataire (`DESTINATAIRE_ABSENT`) |
| `utilisateur_rappel_journee` | utilisateur présent ; `email_rappel_jour` ; `now ≤ created_at + RAPPEL_JOURNEE_RATTRAPAGE_HEURES` ; au moins un rendez-vous dans la journée `occurrence`, recalculée dans le fuseau courant (`AUCUN_RENDEZ_VOUS`) ; destinataire |

Branchement dans `processTransactionalEmail` : claim (refus `pas_encore`), puis `verifierPertinence`, puis chargement, construction, envoi. `ProcessTransactionalEmailResult.statut` reçoit `'annule' | 'pas_encore'`. La cible de `onConflictDoNothing` de `insertTransactionalEmailEvents` inclut désormais `occurrence` (**régression à surveiller**).

### 4.5 Garanties anti-doublon (résumé)
- Tick : ordonnanceur BullMQ unique, plus l'unicité de l'outbox, plus le verrou consultatif pour le plafond.
- Envoi : jobId déterministe, `FOR UPDATE` au claim, bail de 60 s, statut `envoye` vérifié, clé d'idempotence Resend = id de la ligne (24 h côté Resend).
- Panne du worker : au redémarrage, les lignes en retard passent la revalidation ; au-delà du rattrapage, `annule` et aucun envoi périmé.

### 4.6 Coût Resend (à surveiller)
Environ 1 résumé par semaine + jusqu'à 1 rendez-vous du jour par jour ouvré par professionnel actif, plus les rappels visiteur. L'offre gratuite (~100 par jour, 3000 par mois) est dépassée au-delà d'environ 40 à 60 professionnels actifs : prévoir l'offre payante au lancement (S13).

---

## 5. Contenus des e-mails (texte seul, `server/services/emails/contenus.ts` et `notifications-contenus.ts`)

Conventions :
- Toute valeur saisie passe par `singleLine` (objet et lignes), garde étendue aux nouvelles lignes.
- Dates en `fr-FR` dans le fuseau du destinataire : visiteur → `vitrines.fuseau` ; professionnel → `users.fuseau`.
- `{professionnel}` = `displayName(titre, prenom, nom)`. `{site}` = `NUXT_PUBLIC_SITE_URL`.
- Le pied « Vous recevez… » est obligatoire.

### 5.1 `reservation_visiteur_rappel` (au visiteur, sans List-Unsubscribe)
- **Objet** : `Rappel : votre rendez-vous du {jeudi 12 novembre} à {10:00}`. On n'écrit pas « demain » : avec le rattrapage, ce mot peut devenir faux.
- **Corps** :
```
Bonjour,

Petit rappel : votre rendez-vous avec {professionnel} approche.

Service : {service}
Professionnel : {professionnel}
Date : {jeudi 12 novembre 2026 à 10:00}
Durée : {45} minutes                      (si connue)
Lieu : {ville}                            (si connue)
Tarif : {…}
Règlement : sur place

Un empêchement ? Prévenez {professionnel} dès que possible depuis sa vitrine :
{site}/{username}

À bientôt,
Brandself

—
Vous recevez ce rappel parce que vous l'avez demandé en réservant sur la vitrine de {professionnel}. C'est le seul rappel prévu pour ce rendez-vous.
```
Pas de pièce jointe ICS : l'événement a déjà été envoyé et une nouvelle séquence créerait un doublon dans l'agenda du visiteur.

### 5.2 `utilisateur_rappel_journee` (au professionnel, avec List-Unsubscribe)
- **Objet** : `Vos rendez-vous du {mardi 10 novembre}` (s'il y en a un : `Votre rendez-vous du {mardi 10 novembre}`).
- **Corps** :
```
Bonjour {prenom},

Voici votre journée : {n} rendez-vous{, dont {k} à confirmer}.

• {09:00} — {Consultation de cardiologie} — {Marie Ndzi}
• {11:30} — {Bilan} — {Paul Ewane} (à confirmer)
… et {r} autres.                           (au-delà de 20 lignes)

Le détail est dans votre agenda : {site}/studio/agenda

Belle journée,
Brandself

—
Vous recevez cet e-mail parce que vous avez des rendez-vous aujourd'hui.
Ne plus le recevoir, en un clic : {site}/desabonnement?jeton={jeton email_rappel_jour}
Gérer vos e-mails : {site}/studio/compte
```

### 5.3 `utilisateur_resume_hebdo`, avec activité (relationnel)
- **Objet** : `Votre semaine : {3 réservations}, {2 messages}`. Pluriels gérés ; les termes à zéro sont omis ; s'il ne reste que des demandes : `Votre semaine : 1 demande`.
- **Corps** :
```
Bonjour {prenom},

Voici l'activité de votre vitrine du {lundi 26 octobre} au {dimanche 1er novembre} :

• Réservations reçues : {3}
• Demandes reçues : {1}
• Messages reçus : {2}
(• Visites : {n} / • Clics sur vos liens : {n}   — lignes omises tant que la valeur est nulle, S11)

{Cette semaine, 2 rendez-vous sont prévus.}   (si > 0)

Retrouvez tout dans votre studio : {site}/studio

Bonne semaine,
Brandself

—
Vous recevez ce résumé chaque lundi parce qu'il est activé dans votre compte.
Vous désabonner en un clic : {site}/desabonnement?jeton={jeton email_hebdo}
Gérer vos e-mails : {site}/studio/compte
```

### 5.4 `utilisateur_resume_hebdo`, sans activité
- **Objet** : `Une idée pour votre vitrine cette semaine`
- **Corps** :
```
Bonjour {prenom},

Votre vitrine n'a pas reçu de réservation ni de message cette semaine. Une seule idée pour la faire connaître :

{titre de la suggestion}
{texte de la suggestion}
{site}{chemin}                     (partager ou suggestion par défaut : {site}/studio)

Bonne semaine,
Brandself

— (même pied que 5.3)
```
Suggestion = `computeNextStep` (en tenant compte des étapes ignorées) lue dans `shared/prochaine-etape.ts`. Si le résultat est `null` : suggestion par défaut `SUGGESTION_RESUME_DEFAUT` (`shared/notifications.ts`) : titre « Demandez un témoignage », texte « Écrivez à un client satisfait : un avis rassure vos prochains visiteurs avant de réserver. », chemin `/studio/temoignages/nouveau`.

### 5.5 En-têtes (résumé et rendez-vous du jour)
`List-Unsubscribe: <{site}/api/public/desabonnement?jeton=…>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. `EmailMessage` reçoit `headers?: Record<string, string>`, transmis à Resend. L'expéditeur vient de `EMAIL_EXPEDITEUR`.

---

## 6. Routes API

Toutes suivent `defineApiHandler` : Zod, puis service, puis ressource. Aucune logique dans la route. Un dossier par ressource.

| Méthode | Fichier | Corps / requête | Succès | Erreurs |
|---|---|---|---|---|
| GET | `server/api/studio/prochaine-etape/index.get.ts` | — | 200 `{ etape: NextStep \| null }` | 401, 404 `VITRINE_INTROUVABLE` |
| POST | `server/api/studio/prochaine-etape/ignorer.post.ts` | `{ etape }` (`schemaEtapeIgnorer`) | 200 `{ etape: NextStep \| null }` (la suivante). Idempotent (`array_append` seulement si absente, `FOR UPDATE`) | 401, 404, 422 `VALIDATION` |
| POST | `server/api/studio/vitrine/partage.post.ts` | aucun corps | 200 `{ partageeLe: ISO }` (première date conservée) | 401, 404, 422 `VITRINE_NON_PUBLIEE` |
| PUT | `server/api/studio/moi/index.put.ts` (inchangé, schéma étendu) | `{ emailHebdo?, emailRappelJour?, … }` | 200 `MoiDTO` (avec `emailHebdo`, `emailRappelJour`) | 401, 422 |
| GET | `server/api/public/desabonnement/index.get.ts` | `?jeton=` | 200 `{ preference }`. Aucun effet. Ne révèle ni e-mail ni nom | 404 `JETON_INVALIDE`, 410 `JETON_EXPIRE`, 429 |
| POST | `server/api/public/desabonnement/index.post.ts` | `?jeton=` + corps `List-Unsubscribe=One-Click` (form-urlencoded), **ou** JSON `{ jeton }` | 200 `{ preference, desabonne: true }`. Préférence mise à false. Utilisateur introuvable : même 200 (aucun oracle) | 404, 410, 429 |

Détails :
- Désabonnement : limiteur `desabonnement:{ipHash}` 20/min **fail-open** ; en-têtes `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. Le jeton n'est jamais journalisé (le gestionnaire d'erreurs logue `event.path` : utiliser le chemin sans la query string).
- Pas de jeton CSRF : le jeton signé est l'autorisation, et l'opération ne peut que désactiver.
- Service `server/services/desabonnement.ts` : `signUnsubscribeToken(userId, preference, now)`, `verifyUnsubscribeToken(jeton, now)`, `previewUnsubscribe`, `unsubscribe`.
- Service vitrines (lot E) : `getNextStep(userId)`, `ignoreNextStep(userId, etape)`, `markShared(userId)`. `summarize` passe à `computeNextStep({ hasPhoto, servicesActifs, disponibilites, realisationsActives, publiee, partagee, ignorees })`.

---

## 7. Frontend

### 7.1 Compte (`app/pages/studio/compte.vue`, `useCompte.ts`) : écart avec la maquette, qui n'a pas de préférences
Nouvelle partie `<section aria-labelledby="titre-emails">`, h2 « E-mails », entre « Vos informations » et « Connexion et sécurité ». Deux lignes en liste plate (pas de carte), chacune avec un `USwitch` (label lié, description) :
- « Résumé de la semaine » : « Chaque lundi matin, l'activité de votre vitrine en un coup d'œil. »
- « Rendez-vous du jour » : « Le matin, la liste de vos rendez-vous de la journée. »

Note sous la liste (`text-texte-secondaire`) : « Les e-mails liés à vos réservations et à vos messages sont toujours envoyés : ils font partie du service. »

États :
- mise à jour optimiste (patron du fuseau), interrupteur `disabled` + `loading` pendant l'enregistrement ;
- échec : retour à la valeur serveur et message unique sous la partie (« Nous n'avons pas pu enregistrer. Réessayez dans un instant. ») ;
- succès : annonce `aria-live` « Préférences enregistrées. ».

Hauteur de ligne ≥ 44 px.

### 7.2 Formulaire de réservation (`ReservationForm.vue`, `useReservation.ts`)
`USwitch` « Recevoir un rappel par email », description « 24 heures avant le rendez-vous. » (texte construit depuis `RAPPEL_VISITEUR_AVANCE_HEURES`), entre le choix du règlement et le bouton, séparé par des filets comme sur la maquette. `form.rappelEmail` (défaut false, #85) est envoyé au lieu du `false` en dur.

### 7.3 Panneau de partage (`app/components/studio/PartageVitrine.vue`, `usePartageVitrine.ts`)
`UModal` titrée « Partager votre vitrine ». Contenu :
- aperçu du message prêt (paragraphe sur `bg-surface`, lecture seule) ;
- boutons pleine largeur à 390 px : « Envoyer sur WhatsApp » (action principale, `i-ph-whatsapp-logo`), « Partager sur LinkedIn » (`i-ph-linkedin-logo`, copie le message puis ouvre LinkedIn ; annonce « Message copié : collez-le dans votre publication. »), « Copier le message » (`i-ph-copy`) ;
- QR code de `https://{HOTE_VITRINES}/{username}` + « Télécharger le QR code » (SVG, patron de la page Liens).

Chaque geste appelle `POST /api/studio/vitrine/partage` une seule fois par session (sans bloquer : un échec est ignoré silencieusement côté interface et journalisé sans données personnelles). Annonces dans une zone `role="status"` unique. Focus piégé, Échap, retour du focus au déclencheur (fourni par `UModal`).

### 7.4 Écran « C'est en ligne » (`EnLigne.vue`)
Conforme à la maquette : le bouton « Partager sur WhatsApp » utilise le message prêt et enregistre le partage. Écart minimal ajouté sous ce bouton : un lien-bouton discret « Autres façons de partager » qui ouvre `PartageVitrine` (LinkedIn, copie, QR). Le bloc prochaine étape reste sans bouton « ignorer » (maquette).

### 7.5 Accueil du studio (`studio/index.vue`, `ProchaineEtape.vue`)
- `ProchaineEtape` reçoit `ignorable?: boolean` et émet `ignorer` et `action`. Le bouton principal reste celui de la maquette. Écart : sous le bouton, un `UButton variant="link"` « Ne plus proposer cette étape ». Au clic : `POST …/ignorer`, puis remplacement par l'étape suivante (ou disparition), annonce `aria-live` « Étape masquée. », focus déplacé sur le titre de la nouvelle étape ou sur le titre « Votre vitrine ».
- Étape `partager` : le bouton « Partager » ouvre `PartageVitrine` (pas de navigation).
- Partie « Publication » (vitrine publiée) : bouton « Partager ma vitrine » qui ouvre le même panneau, à côté de « Voir ma vitrine ».
- Un seul message à la fois : quand `messagePublication` est affiché, la carte prochaine étape est masquée.

### 7.6 Page `/desabonnement` (`app/pages/desabonnement.vue`, `useDesabonnement.ts`, `ssr: false`, `noindex`)
États :
- chargement (aperçu GET) ;
- valide : h1 « Ne plus recevoir {« le résumé de la semaine » | « les rendez-vous du jour »} ? », texte « Vous pourrez le réactiver à tout moment dans votre compte. », bouton principal « Me désabonner » ;
- succès : h1 « C'est fait. », « Vous ne recevrez plus {libellé}. », lien « Gérer mes e-mails » (`/studio/compte`) ;
- expiré (410) : « Ce lien a expiré. Vous pouvez gérer vos e-mails depuis votre compte. » + lien de connexion ;
- invalide (404) : « Ce lien n'est pas valide. » ;
- erreur ou 429 : message + « Réessayer ».

La page n'affiche jamais l'adresse e-mail. `routeRules` : `/desabonnement` avec `Referrer-Policy: no-referrer` et `Cache-Control: no-store`.

### 7.7 Écarts avec les maquettes (à valider)
1. Partie « E-mails » au Compte : absente de la maquette.
2. Bouton « Ne plus proposer cette étape » : absent de la maquette Studio.
3. « Autres façons de partager » sur En ligne.
4. Interrupteur du rappel désactivé par défaut (la maquette le montre activé).
5. La maquette Studio montre « Ajoutez un premier témoignage » comme prochaine étape, absente de l'ordre SPRINTS (Q5).
6. Les statistiques de l'accueil restent à 0 (Q3).

---

## 8. Critères d'acceptation (Given / When / Then)

Les heures sont en UTC sauf mention contraire. L'horloge est injectée (`now`).

### Base
- **CA01** Given la migration 0020 appliquée, When on insère une ligne `utilisateur_resume_hebdo` avec `occurrence=''`, Then la base refuse (`occurrence_requise_check`).
- **CA02** Given deux insertions `(utilisateur, U, utilisateur_resume_hebdo, '2026-W44')`, When la seconde arrive, Then violation d'unicité (ou aucune ligne insérée avec `onConflictDoNothing`).
- **CA03** Given `categorie='relationnel'` sur un type `reservation_visiteur_rappel`, When on insère, Then la base refuse (`categorie_type_check`).
- **CA04** Given `vitrines.etapes_ignorees = '{autre}'`, When on met à jour, Then la base refuse.
- **CA05** Given la base migrée puis le bloc ROLLBACK exécuté puis la migration rejouée, When on lance la suite d'intégration S7, Then elle est verte (réversibilité).
- **CA06** Given une vitrine dont le username est `desabonnement`, When on applique 0020, Then la migration échoue avec un message explicite ; et le schéma de username refuse désormais `desabonnement`.

### Rappel visiteur
- **CA07** Given une réservation `en_attente`, `rappel_email=true`, début 2026-11-12 09:00Z, vitrine en `Africa/Douala`, When le professionnel la confirme à 2026-11-10 08:00Z, Then une ligne `reservation_visiteur_rappel` existe avec `prochaine_tentative = 2026-11-11 09:00Z`, `occurrence='2026-11-12T09:00:00.000Z'`, `statut='en_attente'`.
- **CA08** Given CA07, When le dispatcher tourne à 2026-11-11 08:59:59Z, Then la ligne n'est pas mise en file ; When il tourne à 09:00:00Z, Then elle part et l'e-mail contient « jeudi 12 novembre 2026 à 10:00 » (heure de Douala).
- **CA09** Given `rappel_email=false`, When confirmation, Then aucune ligne de rappel.
- **CA10** Given un début dans 27 h (heure prévue dans 3 h, sous 6 h), When confirmation, Then aucune ligne de rappel.
- **CA11** Given CA07, When le professionnel annule (ou refuse) avant l'échéance, Then la ligne passe à `annule`, `erreur_code='RESERVATION_ANNULEE'`, et aucun envoi n'a lieu au dispatch.
- **CA12** Given une ligne de rappel `en_attente` dont la réservation est `annulee` (statut modifié hors du service), When l'envoi est traité, Then `annule` / `RESERVATION_NON_CONFIRMEE`, transport non appelé.
- **CA13** Given le worker arrêté de 2026-11-11 08:00Z à 16:00Z, When il redémarre à 16:00Z (7 h de retard), Then la ligne passe à `annule` / `RAPPEL_PERIME`, sans envoi.
- **CA14** Given un retard de 5 h mais un début dans 1 h 30, When traitement, Then `annule` / `RAPPEL_PERIME`.
- **CA15** Given une vitrine en `Europe/Paris` et un rendez-vous le lundi 2026-10-26 à 10:00 heure de Paris (après le passage à l'heure d'hiver du 25), When confirmation, Then `prochaine_tentative = 2026-10-25T09:00Z` (24 h absolues) et l'e-mail affiche « lundi 26 octobre 2026 à 10:00 ».
- **CA16** Given le même job d'envoi exécuté deux fois en parallèle (deux workers), When les deux se terminent, Then le transport a été appelé une seule fois et la ligne est `envoye`.
- **CA17** Given une ligne `en_attente` dont `prochaine_tentative` est dans le futur, When on appelle `processTransactionalEmail` directement, Then le résultat est `pas_encore`, sans envoi ni incrément de `tentatives`.

### Rendez-vous du jour
- **CA18** Given un utilisateur en `Africa/Douala` (UTC+1), `email_rappel_jour=true`, un rendez-vous confirmé le 2026-11-10 à 14:00 heure locale, When la planification tourne à 2026-11-10 05:55Z (06:55 locale), Then aucune ligne ; When elle tourne à 06:00Z (07:00 locale), Then une ligne `utilisateur_rappel_journee` avec `occurrence='2026-11-10'`.
- **CA19** Given CA18, When la planification tourne à 06:05Z puis 06:10Z, Then il existe toujours une seule ligne.
- **CA20** Given aucun rendez-vous dans la journée locale (un rendez-vous à 23:30 locale la veille), When 07:00 locale, Then aucune ligne.
- **CA21** Given la planification arrêtée de 06:00Z à 09:30Z (10:30 locale, au-delà de 07:00 + 3 h), When elle reprend, Then aucune ligne pour ce jour.
- **CA22** Given une ligne créée à 06:00Z et l'unique rendez-vous annulé à 06:01Z, When envoi, Then `annule` / `AUCUN_RENDEZ_VOUS`.
- **CA23** Given une réservation `en_attente` et une `confirmee` dans la journée, When envoi, Then le corps liste les deux, la seconde suivie de « (à confirmer) », et l'intro dit « 2 rendez-vous, dont 1 à confirmer » ; le corps ne contient ni l'e-mail, ni le téléphone, ni le motif du visiteur.
- **CA24** Given `email_rappel_jour=false`, When 07:00 locale, Then aucune ligne ; Given une ligne planifiée puis la préférence désactivée avant l'envoi, Then `annule` / `PREFERENCE_DESACTIVEE`.
- **CA25** Given un utilisateur qui passe de `Africa/Douala` à `America/New_York` après l'envoi de 07:00 Douala, When il est 07:00 à New York le même jour local, Then aucune seconde ligne (même `occurrence`).

### Résumé hebdomadaire
- **CA26** Given un utilisateur en `Africa/Douala`, vitrine publiée, `email_hebdo=true`, 3 réservations, 1 demande et 2 messages créés entre le lundi 2026-10-26 00:00 et le dimanche 2026-11-01 23:59 (heure locale), et 1 réservation créée le lundi 2026-11-02 à 00:30 locale, When la planification tourne le lundi 2026-11-02 à 07:00Z (08:00 locale), Then une ligne `occurrence='2026-W44'` est créée, et l'e-mail compte 3 réservations, 1 demande et 2 messages (la réservation de 00:30 est exclue).
- **CA27** Given CA26, When le corps est construit, Then il ne contient ni « Visites » ni « Clics » ; l'objet est « Votre semaine : 3 réservations, 1 demande, 2 messages ».
- **CA28** Given aucune activité dans la période et `computeNextStep` = `realisation`, When envoi, Then l'objet est « Une idée pour votre vitrine cette semaine » et le corps contient **une seule** suggestion (« Présentez une réalisation », lien `/studio/realisations/nouveau`).
- **CA29** Given aucune activité et toutes les étapes faites ou ignorées, When envoi, Then la suggestion est `SUGGESTION_RESUME_DEFAUT`.
- **CA30** Given un mardi, ou un lundi à 07:59 locale, ou un lundi à 14:00 locale, When planification, Then aucune ligne.
- **CA31** Given une vitrine non publiée, When lundi 08:00 locale, Then aucune ligne ; Given une ligne planifiée puis la vitrine dépubliée, When envoi, Then `annule` / `VITRINE_NON_PUBLIEE`.
- **CA32** Given un compte supprimé après la planification (cascade), When envoi, Then `annule` / `ENTITE_INTROUVABLE`, pas de nouvel essai.
- **CA33** Given un utilisateur à e-mail temporaire sans `email_contact`, When lundi 08:00, Then aucune ligne.
- **CA34** Given `Europe/Paris` et la semaine du 26 octobre au 1er novembre 2026 (changement d'heure le 25, donc semaine entière en heure d'hiver) puis celle du 23 au 29 mars 2027 (passage à l'heure d'été le 28), When `periodeResume` est calculée, Then les bornes sont les minuits locaux (`2027-03-22T23:00Z` → `2027-03-28T22:00Z`, soit 167 h).
- **CA35** Given un utilisateur dont le fuseau en base vaut `Mars/Olympus`, When planification, Then il est ignoré, les autres fuseaux sont traités, et le journal ne contient que le nombre de fuseaux invalides.

### Fréquence
- **CA36** Given une ligne `relationnel` non annulée créée cette semaine ISO locale pour U, When la planification veut insérer un résumé, Then rien n'est inséré.
- **CA37** Given deux planifications concurrentes pour U (deux transactions), When elles s'exécutent, Then une seule ligne relationnelle existe (verrou consultatif + unicité).
- **CA38** Given les e-mails de réservation, de message et du jour (transactionnels) envoyés à U cette semaine, When lundi 08:00, Then le résumé est quand même planifié (le plafond ne compte que les e-mails relationnels).

### Désabonnement
- **CA39** Given un jeton valide `email_hebdo` pour U, When `GET /api/public/desabonnement?jeton=…`, Then 200 `{ preference: 'email_hebdo' }` et `users.email_hebdo` reste true.
- **CA40** Given le même jeton, When `POST ?jeton=…` avec le corps `List-Unsubscribe=One-Click` (form-urlencoded, sans session ni Origin), Then 200 `{ preference: 'email_hebdo', desabonne: true }` et `email_hebdo=false` en base ; un second POST renvoie le même 200.
- **CA41** Given un jeton dont un caractère de signature est modifié, ou un payload modifié (`p` remplacé par `email_rappel_jour`), When POST, Then 404 `JETON_INVALIDE` et aucune modification en base.
- **CA42** Given un jeton émis il y a 91 jours, When GET ou POST, Then 410 `JETON_EXPIRE`.
- **CA43** Given un jeton valide d'un utilisateur supprimé, When POST, Then 200 (pas d'oracle d'existence).
- **CA44** Given 21 POST en 60 s depuis une même IP, When le 21e arrive, Then 429 avec `Retry-After` ; Given Redis indisponible, Then le désabonnement aboutit quand même (fail-open).
- **CA45** Given un résumé construit, When on lit les en-têtes, Then `List-Unsubscribe` contient l'URL https `/api/public/desabonnement?jeton=` et `List-Unsubscribe-Post: List-Unsubscribe=One-Click` ; le rappel visiteur n'a pas ces en-têtes.
- **CA46** Given les journaux du worker et du serveur pendant CA40, When on les inspecte, Then aucun jeton, aucune adresse e-mail et aucun nom n'y figure.

### Préférences et Better Auth
- **CA47** Given une session, When `PUT /api/studio/moi { emailHebdo: false }`, Then 200, `emailHebdo: false` dans le DTO et en base.
- **CA48** Given `PUT /api/studio/moi { emailHebdo: 'non' }` ou une clé inconnue, Then 422.
- **CA49** Given une session, When `POST /api/auth/update-user { fuseau: 'Mars/Olympus', email_hebdo: false }`, Then aucune des deux colonnes ne change.

### Prochaine étape et partage
- **CA50** Given une vitrine avec photo, 1 service actif, 0 disponibilité, When `GET /api/studio/prochaine-etape`, Then 200 `{ etape: 'disponibilites' }`.
- **CA51** Given CA50, When `POST …/ignorer { etape: 'disponibilites' }`, Then 200 `{ etape: 'realisation' }`, `etapes_ignorees` contient `disponibilites`, et un GET ultérieur ne la renvoie plus jamais, même si le nombre de disponibilités reste à 0 (étape mémorisée).
- **CA52** Given tout fait, une vitrine publiée et `partagee_le` NULL, When GET, Then `{ etape: 'partager' }` ; Given non publiée, Then `{ etape: null }`.
- **CA53** Given une vitrine publiée, When `POST /api/studio/vitrine/partage` deux fois, Then 200 les deux fois avec le même `partageeLe` (première date), et GET prochaine étape renvoie `null`.
- **CA54** Given une vitrine non publiée, When POST partage, Then 422 `VITRINE_NON_PUBLIEE`.
- **CA55** Given `{ etape: 'temoignage' }`, When POST ignorer, Then 422 ; Given ignorer deux fois la même étape, Then le tableau ne contient pas de doublon.
- **CA56** Given les routes studio S9, When elles sont appelées sans session, Then 401 (ajout à `e2e/api/studio-auth.spec.ts`).
- **CA57** `buildShareMessage({ prenom:'Cabrel', metier:'Cardiologue', url:'https://brandself.io/dr-cabrel', reservable:true })` renvoie exactement le texte de §3.5 (minuscule initiale sur « cardiologue ») ; `whatsappShareUrl` encode le message ; `linkedinShareUrl` n'encode que l'URL.

### Interface (e2e)
- **CA58** Given l'accueil du studio avec une étape proposée, When « Ne plus proposer cette étape » est activé au clavier, Then une seule carte prochaine étape est visible à tout moment (0 ou 1), l'étape suivante s'affiche, et après rechargement l'étape ignorée n'apparaît pas.
- **CA59** Given Compte, When on bascule « Résumé de la semaine » (Switch, rôle `switch`, aucune case à cocher), Then `aria-checked` change, l'annonce « Préférences enregistrées. » apparaît, et la valeur persiste au rechargement ; Given une 500 simulée, Then l'interrupteur revient et un seul message d'erreur s'affiche.
- **CA60** Given la page `/desabonnement?jeton=valide`, When « Me désabonner », Then « C'est fait. » s'affiche ; Given un jeton expiré, Then le message d'expiration et le lien vers le compte s'affichent ; l'adresse e-mail n'apparaît jamais.
- **CA61** Given l'écran « C'est en ligne », When « Autres façons de partager » est ouvert, Then le panneau montre le message, les boutons WhatsApp, LinkedIn et copie, et le QR code ; Échap ferme et rend le focus ; à 390 px, aucune barre de défilement horizontale.
- **CA62** Given le formulaire de réservation, When l'interrupteur « Recevoir un rappel par email » est activé puis la demande envoyée, Then `reservations.rappel_email = true` en base.

### Réception SPRINTS
- **CA63** (« e-mail de contact reçu ») Given un message envoyé sur la vitrine publiée, When le dispatcher et le worker traitent l'outbox avec un transport d'enregistrement, Then un e-mail `message_professionnel_nouvelle` est envoyé au professionnel et la ligne est `envoye`.
- **CA64** (« rappel au bon moment dans le bon fuseau ») = CA08 + CA15 + CA18.
- **CA65** (« résumé correct avec et sans activité ») = CA26 à CA29.
- **CA66** (« désabonnement effectif ») = CA40, puis le lundi suivant aucune ligne n'est planifiée pour U.
- **CA67** (« une seule prochaine étape à l'écran ») = CA58.

---

## 9. Plan de tests

**Unitaires (Vitest, sans infrastructure)**
- `fenetres.ts` : fenêtres, semaine ISO, journée locale, changements d'heure Paris et New York, UTC+14 et UTC−11.
- `desabonnement` : signature, vérification, falsification, expiration, version inconnue, longueurs inégales.
- Constructeurs de contenus : textes exacts, pluriels, lignes omises, `singleLine`, en-têtes.
- `computeNextStep` : 5 étapes, étapes ignorées, publiée ou non, partagée.
- `buildShareMessage` et les URL de partage.
- Règle du plafond (fonction pure qui décide à partir des lignes).
- `verifierPertinence` sur des entrées construites (fonction pure séparée du chargement).

**Intégration (PostgreSQL + Redis réels, base de test, pas de mock de la couche prouvée)**
- Migration 0020 : montée, ROLLBACK, remontée, et tous les CHECK.
- `transitionOwnReservation` : insertion et annulation du rappel (CA07, CA09 à CA11).
- `listDispatchableTransactionalEmailIds` avec horloge (CA08).
- `processTransactionalEmail` avec un **transport d'enregistrement** (Resend est hors du périmètre prouvé) : CA12 à CA17, CA22 à CA24, CA31 et CA32, concurrence CA16 (deux appels `Promise.all`).
- `planifierNotifications(now)` contre la vraie base : CA18 à CA21, CA25, CA26, CA30, CA33, CA35 à CA38.
- Routes de désabonnement (handler + base + Redis réels ; Redis coupé pour la partie fail-open de CA44).
- Routes prochaine étape et partage.
- `PUT /moi` et le refus via Better Auth (CA49, par `auth.api.updateUser`).
- Purge à 90 jours.

**e2e (Playwright)** : `e2e/api/notifications.spec.ts` (CA39 à CA44, CA50 à CA56), `e2e/notifications.spec.ts` (CA58 à CA62), captures à 390, 768 et 1280 de Compte, du panneau de partage et de `/desabonnement`. À rejouer aussi : `reservation`, `studio-agenda`, `messages`, `onboarding` (EnLigne).

**Gates** : lint, typecheck, unitaires, intégration (en CI : vérifier que le workflow lance bien le projet d'intégration), e2e, build ; zéro test sauté.

---

## 10. Découpage en lots (périmètres de fichiers disjoints)

| Lot | Agent | Fichiers (exclusifs) | Prérequis | Taille |
|---|---|---|---|---|
| **A**, base et contrats | backend | `shared/db/schema.ts` ; `server/db/migrations/0020_s9_notifications.sql`* + `meta/0020_snapshot.json`* + `meta/_journal.json` ; `shared/notifications.ts`*, `shared/partage.ts`*, `shared/prochaine-etape.ts`*, `shared/vitrine.ts` (NEXT_STEPS), `app/utils/prochaine-etape.ts` (réexport, garde le typecheck vert), `shared/jobs.ts`, `shared/schemas/moi.ts`, `shared/schemas/notifications.ts`*, `shared/dto/utilisateur.ts`, `shared/dto/notifications.ts`*, `shared/dto/index.ts`, `shared/erreurs.ts`, `server/exceptions/http.ts`, `shared/limites.ts`, `shared/reserved.ts`, `shared/env.ts`, `server/resources/utilisateur.ts` (2 champs), `server/services/vitrines-regles.ts` (signature de `computeNextStep` + étape partager, pure) | — | M |
| **F1**, tests RED | tester | `tests/unit/**`, `tests/integration/**` (fabriques comprises), `e2e/api/notifications.spec.ts`*, `e2e/api/studio-auth.spec.ts` | A | L |
| **D**, interface Compte, réservation, partage, désabonnement | frontend | `app/pages/studio/compte.vue`, `app/composables/useCompte.ts`, `app/components/reservation/ReservationForm.vue`, `app/composables/useReservation.ts`, `app/components/studio/PartageVitrine.vue`*, `app/composables/usePartageVitrine.ts`*, `app/components/vitrine/EnLigne.vue`, `app/pages/desabonnement.vue`*, `app/composables/useDesabonnement.ts`* | A (parallèle à F1) ; vérifier la forme réelle des réponses de C et E avant la fin | M |
| **E**, prochaine étape (serveur) | backend | `server/services/vitrines.ts` (`summarize`, `getNextStep`, `ignoreNextStep`, `markShared`, `getNextStepForUser` exporté pour B), `server/api/studio/prochaine-etape/index.get.ts`*, `server/api/studio/prochaine-etape/ignorer.post.ts`*, `server/api/studio/vitrine/partage.post.ts`*, `server/resources/vitrine.ts` (si besoin) | A, F1 | S |
| **C**, désabonnement, préférences, Better Auth | backend | `server/services/desabonnement.ts`*, `server/api/public/desabonnement/index.get.ts`*, `server/api/public/desabonnement/index.post.ts`*, `server/services/utilisateurs.ts`, `server/auth.config.ts`, `nuxt.config.ts` (routeRules `/desabonnement`) | A, F1 (parallèle à E) | M |
| **B**, outbox, planification, contenus, worker | backend | `server/services/email-outbox.ts`, `server/services/emails/contenus.ts`, `server/services/emails/notifications-contenus.ts`*, `server/services/emails/transport.ts`, `server/services/notifications/{planification,fenetres,pertinence,plafond,activite,purge}.ts`*, `server/jobs/notifications.ts`*, `server/jobs/email-outbox.ts`, `worker/index.ts`, `server/services/reservations.ts` | A, F1, C (`signUnsubscribeToken`), E (`getNextStepForUser`) | L |
| **E2**, prochaine étape (interface) | frontend | `app/components/studio/ProchaineEtape.vue`, `app/pages/studio/index.vue`, `app/composables/useStudioVitrine.ts` (refresh après « ignorer », si nécessaire) | D (`PartageVitrine`), E | S |
| **F2**, e2e UI | e2e-tester | `e2e/notifications.spec.ts`*, `e2e/helpers/notifications.ts`* | B, C, D, E2 | M |
| **G** | reviewer + security (opus) + regression-checker + ux-reviewer | lecture seule | F2 | M |
| **H** | thread principal | `.env.example` (`EMAIL_EXPEDITEUR=`, `NUXT_PUBLIC_SITE_URL=`), `CLAUDE.md` §8 (rien de neuf si aucune bibliothèque n'est ajoutée), `PROJECT_STATE.md`, `docs/JOURNAL_DECISIONS.md` (#81 à #102), note de déploiement (suivi Resend désactivé, domaine vérifié, SPF/DKIM) | G | S |

\* = fichier créé.

**Ordre** : A → (F1 ∥ D) → (C ∥ E) → B → E2 → F2 → G → H. Trois cycles RED → GREEN au plus par lot backend ; au-delà, retour à l'architecte.

**Consommateurs à vérifier en G** :
- tous les appelants de `insertTransactionalEmailEvents` (cible `onConflictDoNothing` modifiée) ;
- `ProcessTransactionalEmailResult` (worker) ;
- `computeNextStep` (tests S8, `summarize`) ;
- `PROCHAINES_ETAPES` (EnLigne, studio) ;
- `MoiDTO` (useCompte, e2e Compte) ;
- les e2e de réservation qui envoient `rappelEmail` ;
- les e2e S7 et S7-bis qui lisent les statuts de l'outbox ;
- les tests qui listent `TRANSACTIONAL_EMAIL_TYPES`.

---

## 11. Paramètres à rendre configurables depuis le futur panel admin

Tous sont des constantes nommées (`shared/notifications.ts`, `shared/limites.ts`) ou des variables d'environnement. Aucun littéral dans le code :
- **Rappel visiteur** : avance (24 h), écart minimal à la confirmation (6 h), rattrapage (6 h), préavis minimal (2 h), défaut de l'interrupteur (désactivé).
- **Rendez-vous du jour** : heure locale (7 h), rattrapage (3 h), statuts inclus, nombre maximal de lignes (20).
- **Résumé** : jour ISO (lundi), heure locale (8 h), rattrapage (6 h), période (7 j), suggestion par défaut (textes).
- **Fréquence** : nombre d'e-mails relationnels par semaine (1).
- **Planification** : cron du tick (5 min), cron de la purge, taille des lots (500).
- **Rétention** : outbox (90 j).
- **Désabonnement** : validité du jeton (90 j), version, information HKDF, limiteur (20/min/IP).
- **Envoi** : débit Resend (2/s), essais (5) et attente (2 s) existants, expéditeur (`EMAIL_EXPEDITEUR`), URL du site.
- **Textes** : modèles d'e-mails et message de partage (aujourd'hui dans le code ; une table de modèles versionnés comme `prompts_ia` est possible plus tard).

---

## 12. Hors périmètre

WhatsApp ou SMS comme canal, notifications dans le navigateur, centre de notifications (SPRINTS). Suivi des visites et clics fiables (S11). Messages de limite de plan et rappels de renouvellement (S10, qui réutiliseront l'outbox : `categorie='transactionnel'`). Annulation par le visiteur depuis le rappel. E-mails HTML. Modèles d'e-mails éditables.

**Idées** : `annule` pour `ENTITE_INTROUVABLE` sur les types S7 ; transport SMTP vers Mailpit en dev pour voir les e-mails réels ; étape « premier témoignage » ; `statistiques7j.reservations` réel sur l'accueil.

---

## 13. Questions ouvertes (avec proposition)

1. **Visites et clics dans le résumé.** Proposition : rien avant S11 (lignes omises, contrat prêt). Alternative : un compteur minimal `statistiques_jour(vitrine_id, jour, vues, clics)` sans IP ni cookie dès S9. Refusée : sans filtre des robots ni prise en compte du cache, les chiffres seraient faux, et S11 existe pour ça.
2. **Interrupteur du rappel visiteur.** Proposition : désactivé par défaut (le visiteur le choisit explicitement, aucun débat RGPD). La maquette le montre activé. Un rappel de rendez-vous relève de l'exécution du service (art. 6.1.b) : l'activer par défaut serait défendable et réduirait les absences. À trancher.
3. **Statistiques à 0 en dur sur l'accueil du studio** (affichage trompeur). Proposition : afficher le vrai nombre de réservations sur 7 jours et masquer « visites » et « clics » jusqu'à S11 (petit changement dans `summarize` et la ressource, lot E). Non inclus par défaut, parce que cela touche une maquette.
4. **Secret du jeton de désabonnement.** Proposition : HKDF depuis `NUXT_BETTER_AUTH_SECRET` (aucune configuration en plus). Alternative : `DESABONNEMENT_SECRET` dédié, pour pouvoir le faire tourner indépendamment.
5. **« Ajoutez un premier témoignage »** (maquette Studio) absent de l'ordre SPRINTS. Proposition : garder l'ordre SPRINTS en S9 ; la suggestion par défaut du résumé porte déjà sur le témoignage.
6. **Domaine d'envoi.** Il faut un domaine vérifié chez Resend (SPF, DKIM, DMARC) et la valeur de `EMAIL_EXPEDITEUR` (proposition : `Brandself <bonjour@brandself.io>`). Sans eux, aucun e-mail n'atteint les tiers en production.
7. **Réservations `en_attente` dans le rendez-vous du jour.** Proposition : incluses, marquées « à confirmer » (c'est l'action utile du matin).
8. **Page Confidentialité.** Il faut y mentionner les e-mails envoyés (rappels, résumé), la base légale et la conservation de 90 jours de l'outbox. Proposition : lot H ou S13.

---

## Fichiers clés (absolus)

- /home/cabrel/projects/brandself-app/brandself-app/shared/db/schema.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/jobs.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/services/email-outbox.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/jobs/email-outbox.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/jobs/ia.ts (patron d'ordonnanceur)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/emails/contenus.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/services/emails/transport.ts (expéditeur en dur, ligne 4)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/reservations.ts (`transitionOwnReservation`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/vitrines.ts et vitrines-regles.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/auth.config.ts (`additionalFields` sans `input: false`)
- /home/cabrel/projects/brandself-app/brandself-app/app/composables/useReservation.ts (`rappelEmail: false` en dur, ligne 67)
- /home/cabrel/projects/brandself-app/brandself-app/app/components/vitrine/EnLigne.vue
- /home/cabrel/projects/brandself-app/brandself-app/app/pages/studio/index.vue, compte.vue
- /home/cabrel/projects/brandself-app/brandself-app/server/resources/vitrine.ts (`statistiques7j` à 0 en dur, ligne 49)
- /home/cabrel/projects/brandself-app/brandself-app/worker/index.ts