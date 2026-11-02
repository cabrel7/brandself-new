# S7-bis — Agenda public complet, page Contact, Messages, Studio éclaté

Sprint de conformité aux 7 nouvelles maquettes : page publique **Agenda** (le vrai flux de réservation, calendrier d'abord), page publique **Contact** (formulaire → messages), Studio **Agenda / Disponibilités / Messages** éclaté en 3 pages. Le domaine technique est celui de S7 plus un nouveau domaine « Messages ». **TIER CRITIQUE le temps du sprint** : le formulaire Contact collecte des données personnelles (nom, email, téléphone) et déclenche un email au professionnel.

**Contraintes étudiées avant écriture** : l'état actuel a été vérifié dans `shared/db/schema.ts` (réservation 4 statuts, demandes 4 statuts, outbox 6 types), `server/services/creneaux.ts`, `reservations.ts`, `demandes.ts`, `reservation-limiteur.ts`, `server/jobs/email-outbox.ts`, `shared/schemas/agenda.ts`, les routes `server/api/…` et les composants `app/components/agenda/`, `app/pages/[username]/reserver.vue`, `app/pages/studio/agenda.vue`. Aucun service existant n'est réécrit ; les modifications sont listées fichier par fichier en §9.

---

## 1. Objectif

1. Donner au visiteur une **page Agenda dédiée** (`/[username]/agenda`) : flux complet de réservation, calendrier du mois d'abord, créneaux du jour, bouton « Continuer avec… » menant à l'étape de confirmation **existante**.
2. Donner au visiteur une **page Contact** (`/[username]/contact`) : coordonnées de la vitrine + formulaire qui crée un **message**.
3. Informer le professionnel d'un nouveau message par **email job** et lui permettre de les lire dans le Studio.
4. **Éclater le Studio Agenda** en trois pages : Agenda (3 onglets), Disponibilités (page dédiée), Messages (page dédiée), selon les maquettes.
5. Ne rien changer à l'accueil public (bloc agenda et ancre contact gelés pour ce sprint).

---

## 2. Maquettes à conformer

| Maquette (docs/maquettes/) | Écran cible | Éléments visuels sommaires observés |
|---|---|---|
| `Page Agenda · Mobile@2x.png` | `/[username]/agenda` | En-tête marque + bouton **Réserver** (accent) ; titre Fraunces « Agenda » ; sous-titre « Choisissez un service, puis un jour et une heure disponibles. » ; carte surface : `<select>` service (« Consultation de cardiologie · 45 min »), calendrier du **mois** (en-têtes L M M J V S D ; jours passés grisés ; jour courant en contour ; jour sélectionné en aplat accent ; jours avec créneaux = chiffre colorée + point accent sous le chiffre ; flèches ‹ › de mois en haut à droite) ; légende « • Jours avec des créneaux disponibles » ; deuxième carte : date longue en titre, « 6 créneaux disponibles · Heure de Douala », grille de puces d'heures (2 col mobile : « 9 h, 10 h, 11 h 30, 14 h, 15 h 30, 16 h 30 », la sélection en aplat accent), rappel « 🕐 45 minutes » et « 💳 [Prix] XAF · à régler sur place » (icônes Phosphor), CTA pleine largeur « Continuer avec vendredi à 10 h », note « Vous confirmez vos informations à l'étape suivante. » ; pied « Dr Cabrel Nguesso · Douala » / « Créé avec Brandself ». |
| `Page Agenda · PC@2x.png` | idem ≥ 1280 px | En plus : fil d'Ariane « Accueil / Agenda » ; nav Services · Réalisations · Agenda · Contact + bouton Réserver ; calendrier à gauche, carte créneaux à droite (sans séparation par filet dans la maquette). Chiffres des jours « disponibles » en bleu sur la maquette : à remplacer par la couleur texte-accent de la palette (token), jamais de bleu en dur (§7). |
| `Page Contact · Mobile@2x.png` | `/[username]/contact` | Titre « Me contacter » ; sous-titre « Une question avant de réserver ? Écrivez-moi, je vous réponds dès que possible. » ; liste de coordonnées avec pastilles accent-doux et icônes Phosphor : Email / Téléphone / WhatsApp / Cabinet (« Douala, Cameroun ») ; bouton contour « Écrire sur WhatsApp » ; carte accent-doux « Vous préférez réserver ? Choisissez directement un créneau dans l'agenda. » + lien accent « Voir l'agenda › » ; carte surface « Écrivez-moi » : Nom complet\*, Email\*, Téléphone (facultatif), Sujet (`<select>`, « Une question avant de réserver »), Message (textarea) « Quelques lignes suffisent. », CTA « Envoyer mon message », note de consentement « En envoyant, vous acceptez que vos informations soient transmises à Dr Cabrel Nguesso pour répondre à votre message. » ; pied identique. |
| `Page Contact · PC@2x.png` | idem ≥ 1280 px | Fil d'Ariane « Accueil / Contact » ; coordonnées à gauche, formulaire « Écrivez-moi » à droite dans une carte surface. |
| `Studio · Agenda@2x.png` | `/studio/agenda` | Titre « Agenda », sous-titre compteurs « 3 à venir · 2 demandes », avatar rond (accent-doux) à droite, bouton accent « Disponibilités » ; onglets segmentés **À venir / Demandes / Passées** ; groupes par jour (« VENDREDI 23 OCTOBRE » en petites capitales) ; carte par rendez-vous : pastille date (jour en gros + « OCT »), titre du service, « Marie Ndzi · 10 h », étiquette « En attente » (AP accent-doux/texte accent) + « À régler sur place », boutons **Confirmer** (accent plein) / **Refuser** (contour) sous la carte ; carte confirmée : étiquette « Confirmée », ligne pleine largeur « Annuler ce rendez-vous » ; barre du bas mobile inchangée (Vitrine · Services · Réalisations · Liens · Agenda, actif en accent). |
| `Studio · Disponibilités@2x.png` | `/studio/agenda/disponibilités` | Retour « ← Agenda » ; « Vos disponibilités » + sous-titre « Les visiteurs ne peuvent réserver que dans ces plages. » ; une ligne par jour : jour + interrupteur (Switch, accent = ouvert, gris = « Fermé »), plages en paires de champs heure « à » avec bouton ✕, « + Ajouter une plage » par jour ouvert ; titre « Indisponibilités » + sous-titre « Congés, déplacements : ces jours-là, personne ne peut réserver. » ; rangées date + raison + ✕ ; bouton contour « Ajouter une indisponibilité » ; « Réglages avancés » replié ; CTA pleine largeur bas de page « Enregistrer ». Les champs heure y sont affichés « 08:00 AM » : **artefact de maquette** — l'affichage reste **24 h FR** (« 08:00 »), décision justifiée en §10. |
| `Studio · Messages@2x.png` | `/studio/messages` | Retour « ← Vitrine » ; titre « Messages », sous-titre « 2 non lus » ; rangées : avatar initiale (accent-doux), nom en gras, date relative à droite (« Aujourd'hui », « Hier », « Lundi »), point accent si non lu, 2 lignes d'aperçu du message ; filets fins entre rangées ; note de pied « Les messages arrivent aussi par email. Répondez directement depuis votre messagerie. ». |

Points d'écart à traiter (signalés, pas résolus au doigt) : la couleur bleue des jours « disponibles » et le format AM/PM sont des artefacts de maquette (voir §7 et §10) ; le libellé « Cabinet » (carte d'adresse de la page Contact) doit être confirmé s'il est générique (voir §11).

---

## 3. Périmètre / hors périmètre

### Dans le périmètre

- Page publique `/[username]/agenda` (calendrier mensuel, créneaux, CTA), redirection de `/[username]/reserver` quand elle ne sert plus de formulaire.
- Page publique `/[username]/contact` (coordonnées, lien WhatsApp, formulaire de message), nouveau POST `/api/public/:username/messages`.
- Table `messages` (migration 0017), outbox : 2 nouveaux types d'email (`message_professionnel_nouvelle`, `reservation_visiteur_refusee`), statut de réservation `refusee` + route studio `refuser`.
- Studio : `/studio/agenda` réorganisée (3 onglets, bouton Disponibilités), nouvelle `/studio/agenda/disponibilites`, nouvelle `/studio/messages` (liste + marquage lu), APIs studio messages (liste + « lu »).
- Nav publique : « Agenda » pointe vers `/agenda`, « Contact » vers `/contact` (l'ancre `#contact` cesse d'être la cible de la nav).
- Seed : messages de démonstration conformes à la maquette (§15 PROJECT_CONTEXT : vitrine `dr-cabrel`).
- Tests unitaires, intégration (PostgreSQL réel) et e2e, y compris retouche des URL `/reserver`.

### Hors périmètre (interdits de coder ici)

- **L'accueil public est gelé** : `app/pages/[username]/index.vue`, `VitrineCadre`, `VitrineHero`, `AgendaPublic` (bloc de l'accueil), `Pied.vue` — aucun changement. La décision « agenda du jour courant seulement sur l'accueil » sera appliquée dans un sprint ultérieur.
- IA, réservation en ligne / K-PAY (S8/S10), rappels 24 h et résumé hebdo (S9), réponses par messagerie interne (le professionnel répond depuis son email, la maquette le dit), notifications WhatsApp, invitation de témoignage par lien, liked listes de diffusion, traduction.
- La page `/@username` (link-in-bio) et les pages services/réalisations (sauf zéro code : leurs liens vers `/reserver` restent valides grâce à la redirection).
- La réordonnance des affiches des créneaux dans le détail d'un service (`services/[slug].vue` : ses liens `?service&debut` restent fonctionnels tels quels).

---

## 4. Contrat d'API

Conventions inchangées : `defineApiHandler`, l'erreur est `DomainError` → `{ data: { code, champs?/retryAfter? } }`, `VALIDATION` (400) porte `champs`, `TROP_DE_REQUETES` (429) porte `retryAfter` + en-tête `Retry-After`. Toute route publique d'écriture valide par Zod côté serveur (schéma dans `shared/schemas/…`, strict) et passe par la limite IP puis la limite contact.

### 4.1 GET /api/public/:username/creneaux — inchangé, réutilisé pour le mois

Aucun changement de code ni de contrat. La page Agenda appelle la route **existante** avec les bornes du mois :

```
GET /api/public/:username/creneaux?service=consultation-de-cardiologie&du=2026-10-01&au=2026-10-31
200 { service: { id, slug, titre, dureeMin }, fuseau: string, creneaux: [ { debut, fin } ] }
```

- La dérivation « jours du mois avec créneaux » et « créneaux du jour sélectionné » se fait **côté client** à partir de la même réponse (groupement par date locale du fuseau, déjà implémenté par `dateLocaleAgenda`). Justification : `computeCreneaux` est borné par `horizonJours` (62 jours max utiles), la réponse d'un mois reste petite ; une nouvelle route `/creneaux/mois` créerait une seconde source de vérité et un contrat à maintenir pour rien. Le cache est géré par le composable (`usePublicAgenda`, §7), pas en backend.
- Erreurs : 404 `SERVICE_INTROUVABLE` (service inconnu, non `reservable`, ou vitrine non publiée), 400 `VALIDATION` (`du` > `au`, formats).

### 4.2 POST /api/public/:username/reservations — inchangé

Le visiteur arrive sur `/[username]/reserver?…&/reserver/confirmation` comme aujourd'hui ; aucun changement de code ni de contrat. Limite IP `RESERVATION_PUBLIC_LIMIT`, limite contact `RESERVATION_CONTACT_LIMIT` (cf. §4.5).

### 4.3 PATCH /api/studio/reservations/:id/refuser — nouveau

```
PATCH /api/studio/reservations/:id/refuser
Body : {} (schemaAgendaIdParams ; corps vide — pas de motif requis)
200 { item: { id, statut: "refusee" } }
```

- Règles : `en_attente → refusee` ; `refusee` est **terminal** ; le créneau redevient disponible (le refus ne fait pas partie des statuts bloquants ni de la contrainte d'exclusion GiST partielle, inchangée).
- Idempotence : un second appel sur une réservation déjà `refusee` répond **422 `TRANSITION_RESERVATION_INVALIDE`** (mêmes règles que `confirmer`/`annuler`, donc répétable au sens « sans effet de bord », pas sans erreur). Testé en intégration.
- Erreurs : 401 (session), 404 `RESERVATION_INTROUVABLE` (id inconnu **ou** d'une autre vitrine — isolation), 422 `TRANSITION_RESERVATION_INVALIDE` (déjà confirmée/annulée/refusée/terminée).
- Événement email : écrira `reservation_visiteur_refusee` dans l'outbox (§6).

### 4.4 POST /api/public/:username/messages — nouveau

```
Body (schemaMessageCreate, strict) {
  nom: string (1..CONTACT_NOM_MAX, trimé)
  email: email (≤ CONTACT_EMAIL_MAX)
  telephone: E164 | absent          // facultatif (maquette : « Téléphone (facultatif) »)
  sujet: enum sujet (§5, 4 valeurs)
  message: string (1..MESSAGE_MAX)
  siteWeb: literal('')              // nos pages : vide pour un humain
}
201 { message: { id, sujet, creeLe } }
```

- Enchaînement des gardes, copié ou ordonné sur `reservations/index.post.ts` : IP via `getClientIp` + `enforceLimit` (fail-closed) → lecture Zod → `enforceContactLimit('message-contact', username, email, telephone ?? null)` (fail-closed) → création en une transaction : insert `messages` + insert outbox `message_professionnel_nouvelle` (via `insertTransactionalEmailEvents`) → 201. La création est refusée de façon identique (réponse générique) si `siteWeb` non vide.
- Erreurs : 400 `VALIDATION` (`champs`), 404 `VITRINE_INTROUVABLE` (username inconnu ou vitrine non publiée — la page Contact n'existe que sur une vitrine publiée), 429 `TROP_DE_REQUETES` (+ `retryAfter`), 503 `LIMITEUR_INDISPONIBLE`. Un message déclenché par limite **n'est jamais inséré** (les compteurs montent après validation du corps).

### 4.5 POST messages — limite de contact, détail du paramètre `tel`

Nouveau module `server/services/contact-limiteur.ts`, **extension de la mécanique existante de `reservation-limiteur.ts`** (mêmes clés SHA-256 hachées sans données en clair, même `failClosed: true`, clés de l'espace de nommage en argument) :

```
enforceContactLimit(namespace, username, email, telephone: string | null)
  limite/message : MESSAGE_CONTACT_LIMIT { limit: 5, windowS: 600 }   // par IP
  limite/contact : MESSAGE_CONTACT_LIMIT { limit: 3, windowS: 86400 } // par vitrine+contact
```

- `reservation-limiteur.ts` est conservé tel quel et peut être simplifié plus tard (dette notée). Ses clés restent `reservation-contact:v1:…` (aucun invalidation nécessaire).
- Honeypot : même mécanique que demandes/réservations (`siteWeb` littéral vide). Pas de piège temporel : enrichissement pas nécessaire, opération transversale ; le coûteux (normalisation email/téléphone/hachage) est déjà protégé par la limite contact.

### 4.6 GET /api/studio/messages — nouveau

```
GET /api/studio/messages
200 { items: [ MessageStudioDTO ], nonLus: number }
MessageStudioDTO { id, nom, email, telephone: string | null, sujet: string, message,
                   luLe: string | null, creeLe: string }
// listé par creeLe desc ; luLe écho n'est utile qu'au badge de détail (pas au rendu)
```

- 401 sans session ; 404 `VITRINE_INTROUVABLE` si aucun user n'a de vitrine. Toute `VITRINE_INTROUVABLE`/`MESSAGE_INTROUVABLE` renvoyée par le service (jamais d'ORM cru — les routes sont fines, le DTO vient d'un resource).

### 4.7 POST /api/studio/messages/:id/lu — nouveau

```
POST /api/studio/messages/:id/lu
Body : {} (schemaAgendaIdParams)
200 { item: { id, luLe: string } }      // idempotent : rePOST ne change pas luLe
401 | 404 MESSAGE_INTROUVABLE (id d'une autre vitrine ou inconnu)
```

- Le marquage a lieu **au premier dépliage** du message côté UI (§7) — pas à l'ouverture de la liste.

---

## 5. Model de données — migration 0017

Fichier `server/db/migrations/0017_messages_refus.sql` (généré + complété à la main si drizzle-kit ne couvre pas certains changements ; conventions des migrations 0013-0016 : SQL forward, pas de down). Pseudo-SQL complet :

```sql
-- 1) Table messages
CREATE TABLE "messages" (
  "id" text PRIMARY KEY NOT NULL,
  "vitrine_id" text NOT NULL,
  "nom" text NOT NULL,
  "email" text NOT NULL,
  "telephone" text,                       -- facultatif ; jamais un JSON, jamais une étoile
  "sujet" text NOT NULL,
  "message" text NOT NULL,
  "lu_le" timestamp with time zone,       -- = date du dépliage du message au studio
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messages_vitrine_id_vitrines_id_fk"
    FOREIGN KEY ("vitrine_id") REFERENCES "public"."vitrines"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "messages_sujet_check" CHECK ("messages"."sujet" IN (
    'question_avant_reservation','demande_information','suivi_reservation','autre')),
  CONSTRAINT "messages_nom_check" CHECK (char_length("messages"."nom") BETWEEN 1 AND 120),
  CONSTRAINT "messages_email_check" CHECK (char_length("messages"."email") <= 254 AND "messages"."email" ~ '^\S+@\S+'),
  CONSTRAINT "messages_telephone_check"
    CHECK ("messages"."telephone" IS NULL OR "messages"."telephone" ~ '^\+\d+$'),
  CONSTRAINT "messages_message_check" CHECK (char_length("messages"."message") BETWEEN 1 AND 1000)
);
-- Score : liste des messages du pro, décroissant au créneau récent d'abord.
CREATE INDEX "messages_vitrine_id_cree_le_idx" ON "messages" USING btree ("vitrine_id","cree_le" DESC);
CREATE INDEX "messages_non_lus_idx" ON "messages" USING btree ("vitrine_id","cree_le" DESC)
  WHERE "lu_le" IS NULL;

-- 2) Statut refusee (au maquette : affichage Refuser et libellé et email distincts d'une annulation)
ALTER TABLE "reservations"
  DROP CONSTRAINT "reservations_statut_check";
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_statut_check"
  CHECK ("reservations"."statut" IN ('en_attente', 'confirmee', 'annulee', 'terminee', 'refusee'));
-- Aucun index GiST à modifier : la contrainte d'exclusion (0016) reste partielle sur
-- ('en_attente','confirmee') ; « refusee » n'est jamais bloquant, comme « annulee ».

-- 3) Emails transactionnels : deux nouveaux types + une nouvelle entité « message »
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_type_check";
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_type_check";
ALTER TABLE "emails_transactionnels" DROP CONSTRAINT "emails_transactionnels_entite_coherence_check";
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_type_check" CHECK (
  "emails_transactionnels"."type" IN (
    'reservation_professionnel_nouvelle','reservation_visiteur_recue',
    'reservation_visiteur_confirmee','reservation_visiteur_annulee',
    'reservation_visiteur_refusee',
    'demande_professionnel_nouvelle','demande_visiteur_recue',
    'message_professionnel_nouvelle'
  )
);
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_type_check"
  CHECK ("emails_transactionnels"."entite_type" IN ('reservation', 'demande', 'message'));
ALTER TABLE "emails_transactionnels" ADD CONSTRAINT "emails_transactionnels_entite_coherence_check" CHECK (
  ("emails_transactionnels"."entite_type" = 'reservation' AND "emails_transactionnels"."type" LIKE 'reservation_%')
  OR ("emails_transactionnels"."entite_type" = 'demande' AND "emails_transactionnels"."type" LIKE 'demande_%')
  OR ("emails_transactionnels"."entite_type" = 'message'  AND "emails_transactionnels"."type" LIKE 'message_%')
);
```

Note : la colonne du schéma Drizzle s'appelle `creeLe`/`createdAt` selon la table — les tables métier récentes utilisent `createdAt` en base (`created_at`), pas `cree_le` : on **garde `created_at`/`updatedAt`** (cohérence avec `demandes`, `reservations`, `temoignages`) et l'écho du sommet SQL au-sus esa « `cree_le` » rotisma ša culpa. Le pseudocode exact à livrer est celui des migrations précédentes ; la seule déviation assumée : `created_at` au lieu de `cree_le`. `lu_le` suit le pattern déjà validé du projet (`confirmation_expire_le`, deux `_le` lisible).

### Schéma applicatif (cf. conventions existantes)

- `shared/message.ts` (créé) : `SUJETS_MESSAGE`, `SUJET_LIBELLES`, `MESSAGE_MAX = 1000`, `MESSAGE_NOM_MAX = CONTACT_NOM_MAX`, `MESSAGE_EMAIL_MAX = CONTACT_EMAIL_MAX`, `MESSAGE_TELEPHONE_MAX` = 20. Réappellera les limites transversales de `shared/agenda.ts` ; ne duplique rien.
- `shared/schemas/message.ts` (créé) : `schemaMessageCreate` (strict,CEL), `schemaMessageIdParams` (canditié à `schemaAgendaIdParams`), et `schemaMessageLu` (corps vide).
- `shared/agenda.ts` : ajouter `'refusee'` à `RESERVATION_STATUTS` (+ le type s'adapte automatiquement). Aucune autre limite ne change : `CAN_TRANSITION` réside dans `reservations-regles.ts` (mis à jour en backend §9).
- `shared/reserved.ts` : **aucun ajout nécessaire**. `messages` n'est pas un chemin de la racine du site (la route est `/api/public/:username/messages`, le formulaire vit sur `/[username]/contact`) — un username `messages` n'entre en collision avec rien. `contact` est déjà réservé : unaffected.

---

## 6. Jobs BullMQ

File **existante** `emails`, worker existant, outbox PostgreSQL existant (idempotence = index unique `(entite_type, entite_id, type)`, accepte au client idempotence clé `brandself-email-<outboxId>` via Resend). BullMQ options unchanged:

```ts
// shared/jobs.ts — ajoute 2 types
TRANSACTIONAL_EMAIL_TYPES + [
  'reservation_visiteur_refusee',
  'message_professionnel_nouvelle',
]
```

| Événement | Queue | Job | Payload | Retry | Idempotence |
|---|---|---|---|---|---|
| Message reçu | `emails` | `JOBS.sendTransactionalEmail` | `{ outboxId }` | attempts 5, backoff exponentiel 2 s | outbox `(message, message_id, message_professionnel_nouvelle)` unique + jobId `email-outbox-<outboxId>` + clé Resend |
| Réservation refusée | `emails` | idem | idem | idem | idem (type `reservation_visiteur_refusee`) |

Le déclenchement reste le pattern actuel (`insertTransactionalEmailEvents(tx, entiteType, entiteId, types)` **dans la transaction** d'écriture, puis `dispatchPendingTransactionalEmails` interrogé par le poller du worker — aucun changement d'index d'outbox ni d'orchestrateur). Nouveau loader `loadMessageContent` dans `email-outbox.ts` choisit les contenus pesant email address du professionnel existant (`professionalRecipient`, gestion d' pour les comptes de démo via `emailContact`). Aucune adresse visiteur n'est envoyée au professionnel différent du message lui-même (nom, email, téléphone et texte du message, tel quel).

Le modèle de contenu en vouvoiement :
- `message_professionnel_nouvelle` : objet « Nouveau message de [nom] — [sujet] », corps : ajoute une traduction persistante au crée-du-professionnel pour rendre BU ; contenu entier du message ; email/téléphone si fournis ; boutique » à la vitrine.
- `reservation_visiteur_refusee` : objet « Votre demande n'a pas pu être confirmée » ; corps expliquant le refus sans blâmer, « Vous pouvez choisir un autre créneau sur la vitrine. » ; le créneau que l'employé a choisi est signalé.

---

## 7. Spécifications UI par écran

Règles transversales maquettées, non négociables : mobile 390 d'abord puis 768/1280 ; **vocabulaire CLAUDE.md** (agenda, réservation, message — jamais « bloc/section/panel/module » côté affichage) ; icônes Phosphor `i-ph-*` uniquement ; aucune couleur brute (tokens des palettes) ; contraste ≥ 4,5:1 (texte sur accent = `sur-accent` — la couleur bleue fictive des jours « disponibles » devient la variable d'accent texte ; le jour sélectionné « aplat accent » sur texte `sur-accent`) ; un seul message à l'écran à la fois ; tous les états : chargement, vide, erreur, focus visible, désactivé ; heures au format **FR 24 h** (« 9 h », « 15 h 30 » en public comme aujourd'hui, « 08:00 » en studio).

### 7.1 Page publique `/[username]/agenda` (maquettes Page Agenda · Mobile / PC)

- **Nouveau page `app/pages/[username]/agenda.vue`**, SSR, palette et SEO de la vitrine (pattern de `reserver.vue`). Title `Agenda — {professionnel}`.
- **Fil d'Ariane** (≥ 1280) : « Accueil » (lien) / « Agenda » (courant), `aria-label="Fil d'Ariane"`.
- **En-tête** : reprend la barre VitrineCadre existante (la page est rendue **dans** `VitrineCadre` comme les autres pages publiques : nav + footer). Le cadre est inclus par composition ; Ne note pas de refonte de nav ici (les modifications de Nav sont au §7.6).
- **Calendrier mensuel** :
  - `USelect` : services `reservable` de type rdv/accompagnement ; label = `« {titre} · {formatDureeCourte} »` (comme `AgendaPublic.vue` ; état vide : `Aucun service réservable` retenu, et masque la sélection si 1 seul… non : toujours afficher le select, la maquette l'affiche).
  - Navigation de mois : bouton précédent/suivant (`i-ph-caret-left`/`i-ph-caret-right`, zones ≥ 44 px, disabled aux extrêmes = avant le mois courant / après `au = horizonJours` depuis aujourd'hui).
  - Grille 7 colonnes (L M M J V S D) ; cellule du jour : bouton `<button>` : **ayant des créneaux** point sous le numéro, **désactivée** (passe) & grisée, sélectionné aplat accent. `aria-pressed`, `aria-label` = date longue libellée clavier, `role=group` nommé « Jours du mois ».
  - Légende : `i-ph-circle-fill` accent + « Jours avec des créneaux disponibles ».
  - États : chargement = USkeleton (réseau mensuel) ; vide (aucun créneau du mois) = message « Aucun créneau en {mois} — revenez plus tard » (une seule phrase avec bouton « Mois suivant » désactivé si hors horizon) ; erreur = `role=alert` + Suggestions réseau « Réessayer ».
- **Carte créneaux du jour** : titre = date longue FR ; sous-titre « {n} créneau{x} disponibles · Heure de {ville du fuseau} » (le texte « Heure de Douala » vient déjà du helper existant — capitalisation alignée maquette) ; grille de puces 2 col mobile / 3 col‡ PC ; sélection au clic (`aria-pressed`), CTA pleine largeur **« Continuer avec {jour long lowercase} à {heure} »** désactivé sans sélection ; le CTA **mène à l'étape de confirmation existante : `/${username}/reserver?service={slug}&debut={debut ISO}`** (c'est l'URL exacte actuelle de l'étape recap+formulaire, `reserver.vue` mode paramètres — réutilisation intégrale des composants `ReservationRecap` + `ReservationForm`, aucune redirection nécessaire) ; note « Vous confirmez vos informations à l'étape suivante » ; ligne heur « 🕐 {durée}» + paiement « 💳 {prix} · à régler sur place ».
- Arrière plan : les données viennent exclusivement de GET `creneaux` (du/dy mois courant, **un mois à la fois) ; le composable bufferise les mois (cache en mémoire par clé `service|mois`)** ; navigation de mois = rafraîchissement si le mois n'est pas encore en cache ; le jour proposé par défaut = premier jour ayant un créneau (sinon 1er jour désactivé).
- Aucun store global : `useAsyncData`/`$fetch` local, comme les autres pages publiques.
- A11y : h1 unique « Agenda », hiérarchie h2 (calendrier, jour), `aria-live` discret sur le nombre de créneaux (pas d'annonce à chaque reselect).

### 7.2 Étape confirmation — inchangée (integration only)

`app/pages/[username]/reserver.vue` : sa branche « sans paramètres valides » (« Choisissez d'abord un créneau ») devient une **redirection 308** vers `/{username}/agenda` (`navigateTo(url, { redirectCode: 308 })` exécuté côté serveur pendant SSR), avec préservation des paramètres valable `service&debut` (mode formulaire) — cette branche-là reste telle quelle (URL /reserver?…). Les liens d'erreur internes (« Choisir un autre créneau », « Voir l'agenda », « Modifier » de `ReservationRecap`) pointent désormais `/{username}/agenda?service=…` si renseigné. Ni le formulaire ni le flux de cookie/ICS ne bougent.

### 7.3 Page publique `/[username]/contact` (maquettes Page Contact · Mobile / PC)

- **Nouveau page `app/pages/[username]/contact.vue`**, SSR, cadre Vitrine, palette, SEO.
- Fil d'Ariane (« Accueil / Contact »), h1 « Me contacter », sous-titre tel que maquette.
- **Infos contact** (composant `app/components/contact/ContactInfos.vue`) — mapping exact des colonnes existantes de `vitrines`/DTO public `contact` :

| Carte maquette | Source | Affiché si | Action |
|---|---|---|---|
| Email | `vitrine.contact.email` (colonne `email_contact`, sinon rien — déjà filtré service) | presente | `mailto:` |
| Téléphone | `vitrine.contact.telephone` | presente | `tel:` |
| WhatsApp | `vitrine.contact.whatsapp` (**colonne existante, aucun ajout de schéma — celle-ci existe déjà**) | presente | lien `wa.me` construit via `lienWhatsapp` (message d'accroche neutre « Bonjour, je vous contacte depuis votre vitrine Brandself. ») |
| Localisation (« Cabinet ») | `vitrine.ville`, `vitrine.paysLibelle` | toujours | aucun |

Le bouton contour « Écrire sur WhatsApp » n'apparaît **que si** WhatsApp existe ; la carte WhatsApp est masquée sinon. Les cartes Email/Téléphone aussi se masquent proprement si absentes (elles apparaissent toujours au moins une carte : « Cabinet »).
- Carte réserve : « Vous préférez réserver ? … Voir l'agenda › » → `/{username}/agenda`.
- **Formulaire** (`app/components/contact/ContactMessageForm.vue`, composable `app/composables/usePublicMessage.ts`) :
  - Champs : « Nom complet » (requis), « Email » (requis), « Téléphone (facultatif) », « Sujet » = `USelect` avec les 4 sujets (§5) — **la maquette n'en montre qu'un ; les 3 autres sont INCONNUS de la maquette, à confirmer (§11)** ; « Message » (textarea, `Quelques lignes suffisent.`) ; honeypot `siteWeb` champs caché (identique à `DemandeForm.vue`) ; CTA « Envoyer mon message ».
  - Vraies balises (`label`, `input`, `select`, `textarea`, `button`), `aria-required`, erreurs sous champs (`aria-invalid` + `aria-describedby`), message d'erreur page unique (`role=alert`), état `envoi` = bouton désactivé + libellé inchangé ou texte « Envoi… » **sans nouvelle action**, succès = un unique `role=status` « Votre message est envoyé. {nom du pro} vous répond dès que possible. » (formulaire réinitialisé, message ne disparaît pas avant la nouvelle saisie) ; 429 = message régulier sail user-friendly (`retryAfter` humanisé, comme `useReservation`).
  - Consentement affiché sous le CTA, libellé exact de la maquette.
- **Aucun store global** : le POST est unique (`POST /api/public/:username/messages`), la réponse ne sert qu'à l'état d'affichage.

### 7.4 Studio `/studio/agenda` (maquette Studio · Agenda)

- `app/pages/studio/agenda.vue` **réorganisée** (composable conservé `useStudioAgenda.ts`) :
  - En-tête : h1 « Agenda », sous-titre compteurs « {a_venir} à venir · {demandes} demandes » (masque « · {n} demandes » si 0), avatar compte (existant dans le layout Studio) à droite, bouton accent plein « Disponibilités » → `/studio/agenda/disponibilites`.
  - Onglets à 3 (segmented like today's 2) : **À venir / Demandes / Passées**, `role=tablist` + flèches clavier (le code tablist existant s'étend) ; l'onglet Demandes contient les demandes (`nouvelle/en_cours/traitee/refusee`) avec les actions actuelles (« En cours », « Traiter », « Refuser ») ; l'onglet À venir ne contient **plus que les réservations** actives ; Passées = réservations terminées/annulées/**refusées** + demandes traitées/refusées.
  - Cartes grouped by jour : en-tête « VENDREDI 23 OCTOBER » petites capitales uniquement à partir de l'onglet À venir (à venir triées par début ; passées triées antichronologiquement, gardées plates sous un même en-tête unique « Passées », **le tri par jour date-à-déca la carte** suit la maquette).
  - Actions réservation : `en_attente` = **Confirmer** (solid accent) + **Refuser** (contour, couleur error au clic confirm dialogue ; la maquette est neutre → variante outline **sans rouge**), et « Annuler » disparaît (le refus couvre l'annulation d'une demande en attente, la maquette ne montre que 2 boutons) ; `confirmee` = ligne « Annuler ce rendez-vous » (ghost plein largeur) ; **Refuser = nouveau statut `refusee`** (émail + créneau libéré, cf. §4.3/§10). Demandes inchangées.
  - Les états chargement/vide/erreur/absente actuels (UEmpty) restent, déclinés par onglet (« Aucun rendez-vous à venir », « Aucune demande », « Rien de passé — tout est traité »).
- **Le composable `useStudioAgenda`** garde ses sources de données (disponibilités, indisponibilités, réservations, demandes) : disponibilités/indisponibilités **continuent d'être fetchées ici** pour l'aperçu ? **Non** — ce sont désormais réservées à la page Disponibilités : le composable est scindé en deux : `useStudioAgenda` (réservations + demandes + onglets) et `useStudioDisponibilites` (disponibilités + indisponibilités + réglages + Enregistrer). Approche assumée : **le split se fait par double-module avec code partagé réexp portion de helpers déjà écrits** ; c'est la plus petite décomposition lisible sans déplacer la logique métier (elle reste côté service).

### 7.5 Studio `/studio/agenda/disponibilites` (maquette Studio · Disponibilités)

- Nouvelle page, `StudioRetour to=/studio/agenda label="← Agenda"` (composant existant, tout simplement réutilisé ; le mockup : lien texte en haut à gauche). Barre du bas mobile masquée (écran enfant — cf. §7.7).
- Contenu = les deux composants existants `StudioAgendaDisponibilites` + `StudioAgendaIndisponibilites` (INCHANGÉS sauf détail d'affichage sous §9) + « Réglages avancés » replié (fuseau, pas, préavis, horizon = widgets existants) + le bouton « Enregistrer » plein pleine largeur en bas de page (reinforced sticky mobile : bouton fixe restant au-dessus de la barre du bas masquée) ; l'état `modifiees` (dot enregistrement) reste.
- Le « + Ajouter une plage », la suppression ✕, la Switch Fermé (Dimanche) figurent déjà dans le composant existant — conformité visuelle (spacing), pas réécriture.
- Le mockup AM/PM est **non conforme à l'existant** ; on garde l'affichage 24 h FR, justifié en §10 (la base utilise `time HH:mm`, TVA) et en daté maquette flag.

### 7.6 Studio `/studio/messages` (maquette Studio · Messages)

- Nouvelle page appelable depuis l'*(écran Vitrine*)** — voir decision §10 point 8 et §11.
- `StudioRetour to=/studio label="← Vitrine"`, h1 « Messages », sous-titre « {n} non lus » (masqué si 0), rangée par message : avatar initiale (pastille accent-doux, initiale du nom), nom en gras, date relative à droite (« Aujourd'hui » / « Hier » / jour long du jour de la semaine + «, »…) ; point accent si `luLe === null` ; 2 lignes d'aperçu (message tronqué à ~2 lignes, dépliable) ; filets entre les rangées.
- **Interaction** : un clic déplie le message complet (nom, sujet, email, téléphone s'il existe, texte) puis déclenche idempotent POST `lu` si `luLe === null` (le point et le compteur Artefact se mettent à jour)—le dépliage est contrôlé localement (pas de route nouvelles ni écriture en masse). repliement : `aria-expanded` sur le bouton-rangée, focus preserved ; dépliage accessible clavier.
- Pied : la note maquette « Les messages arrivent aussi par email. Rpondez directement depuis votre messagerie. » (texte exact).
- États : chargement (skeletons continus à la hauteur de liste), vide (UEmpty « Aucun message pour l'instant — ils arrivent surtout après la mise en ligne, patience. », icône `i-ph-chat-circle-dots`), erreur réseau (role=alert + Réessayer, pattern actuel Studio).
- Pas de réponse depuis le studio, pas de suppression, pas de tri manuel (hors périmètre §3).

### 7.7 Nav Studio et nav publique

- **Nav Studio** (`useStudioNav.ts`) : la barre 5 entrées **ne bouge pas** (la maquette la montre telle quelle). Les nouvelles pages `/studio/agenda/disponibilites` et `/studio/messages` sont déclarées **écrans enfants** (`ECRANS_ENFANTS`) → barre du bas masquée et propre retour ; la page Messages est aussi collée à `/studio` via le retour « ← Vitrine ». Utiliser l'entrée Agenda active sur `/studio/agenda/disponibilites` (préfixe `estActive` déjà ok).
- **Entrée vers Messages** : ligne « Messages » ajoutée à l'écran Studio `/studio` (l'écran Vitrine, liste des lignes avec compteurs) libellée « Messages · {n} non lus » (ou « Tout est lu ») — y compris **badge point accent**, CLI (sur l'ajout de ligne dans la liste existante).
- **Nav publique** (`app/components/vitrine/Nav.vue`) :
  - « Agenda » → `/{username}/agenda` (au lieu de `/{username}#agenda`), actif quand `route.path` commence par `/{username}/agenda` ;
  - « Contact » → `/{username}/contact` (au lieu de `#contact`), actif sur `/contact` ; la ligne reste inconditionnelle, comme aujourd'hui ;
  - le bouton « Réserver » coupé jusqu'à `/{username}/agenda` (au lieu de /reserver) ;
  - L'accueil garde sa propre ancre `Pied` `id="contact"` (aucun changement à aucun anchor CTA) ; seulement la nav change de cible.
- Sur mobile la nav ne montre que la marque + « Réserver » (comme aujourd'hui, maquette conforme) ; footer identique.

---

## 8. Critères d'acceptation

Chaque critère est testable. Les critères SQL s'exécutent contre le **PostgreSQL réel** (pattern de `tests/integration/reservations.test.ts` / `tests/integration/agenda.test.ts` : base dédiée, helpers `creerContexteAgenda`, aucune maquette de repository). « e2e » = Playwright. **Tests de contact/mesures hors nomination** : les compteurs `limite:*` sont purgés dans `e2e/global-setup.ts` (aucune clé additionnelle nécessaire : notre espace `message-contact:v1` est englobé par le purge `limite:*` — vérifier le préfixe exact au code, sinon étendre d'une ligne).

### 8.1 Route GET /creneaux (réutilisable mensuel)

| # | Given | When | Then |
|---|---|---|---|
| CA1 | vitrine publiée, service rdv actif | GET `/api/public/{u}/creneaux?service=…&du=2026-11-01&au=2026-11-30` | 200 `{ service, fuseau, creneaux }` ; chaque `debut` ∈ [du_months] ou borné horizon ; les jours `indisponibilites` et jours passés/préavis sont absents. (Test unitaire consommé par les tests existants — pas de code nouveau, régression couverte par la suite actuelle.) |
| CA2 | Aucune route nouvelle n'existe | GET `/api/public/{u}/creneaux/mois` | 404 (aucun registre spontané — preuve e2e négative : ne doit pas s'enregistrer). |

### 8.2 Refuser une réservation (statut refusee)

| # | Given | When | Then |
|---|---|---|---|
| CA3 | réservation `en_attente` (PG réel) | PATCH studio `/refuser` avec la session du propriétaire | 200 `{ item: { statut: "refusee" } }` ; ligne lue en SQL = `refusee` ; email outbox = 1 ligne `(reservation, id, reservation_visiteur_refusee, en_attente)`. |
| CA4 | réservation refusée | GET créneaux sur le jour concerné (service temporel) | le créneau refuse 100 % reconnectable : `computeCreneaux` re-propositionne le créneau (statuts bloquants ne contiennent pas refusee) ; **test SQL réel** (PG) : insertion d'une nouvelle réservation sur CE créneau = OK ; **contrainte GiST** (0016) jamais déclenchée par un refus. |
| CA5 | réservation `confirmee` | PATCH `/refuser` | 422 `TRANSITION_RESERVATION_INVALIDE` ; une réservation `refusee` re-PATCH : 422 idem ; une réservation d'une autre vitrine : 404 `RESERVATION_INTROUVABLE` (isolation). |
| CA6 | statuts | UNION tbl `reservations.statut` | `refusee` acceptée en SQL réel (CHECK élargie par 0017) ; `invalide_statut` rejetée par PG (CHECK). |
| CA7 | UI | onglet À venir, carte En attente | boutons Confirmer (solid) + Refuser (contour) ; clic Refuser = boîte de confirmation « Refuser cette réservation ? Le créneau redeviendra disponible. » ; après succès : étiquette devient « Refusée », la carte passe dans Passées, message succès unique. |

### 8.3 Messages — public + email

| # | Given | When | Then |
|---|---|---|---|
| CA8 | vitrine publiée (PG réel) | POST `/api/public/{u}/messages` { nom, email, sujet, message } | 201 `{ message: { id, sujet, creeLe } }` ; ligne SQL `messages` complète (`createdAt` présent, `telephone` null), outbox 1 ligne `message_professionnel_nouvelle` **dans la même transaction** (le test rejoue la transaction échec cas pour preuve d'atomicité : l'outbox est annulée si l'insert échoue). |
| CA9 | message envoyé par le visiteur | worker (job `emails`) | email reçu par le serveur de courriels de test, objet « Nouveau message… », destinataire = `emailContact` ou email compte (règle `professionalRecipient`), message contient le texte EXACT du visiteur ; statue `envoye` (envoyé) après help ; un re-POST outbox dupliqué est ignoré (index unique). |
| CA10 | formulaire rempli une 4e fois dans 24 h avec le même email | POST | 429 `TROP_DE_REQUETES` + `Retry-After` ; aucune ligne SQL message créée. (limites : `MESSAGE_CONTACT_LIMIT` 3/24 h, contact hashé SHA-256 : **test SQL/Redis réel** pattern `reservation-limiteur.test.ts`). |
| CA11 | navigateur headless (e2e) | POST avec `siteWeb` non vide | 400 `VALIDATION`, aucune ligne créée (honeypot et ce qui mérite un test e2e, pas unitaire seul). |
| CA12 | formulaire valide (e2e) | saisie + « Envoyer mon message » | 201 ; état succès affiché ; aucune PII dans l'URL ni localStorage (`verifierAbsencePii` pattern) ; email vérifié côté serveur de courriels test. |
| CA13 | personnes sans téléphone | POST avec `telephone` absent | 201 conforme (facultatif, jamais null-check client une seule fois). |
| CA14 | 1 seul message à l'é | toutes les erreurs (réseau, validation, 429) | jamais 2 bandeaux ; une seule erreur, wording vouvoiement, aucune vocabulaire « espace/bloc ». |

### 8.4 Studio Messages + lu

| # | Given | When | Then |
|---|---|---|---|
| CA15 | 3 messages (2 non lus) | GET `/api/studio/messages` (PG réel) | 200 `items` triés `created_at` DESC, `nonLus: 2` ; **aucune clé technique** d'ORM (`vitrineId` absent, DTO resource). |
| CA16 | message non lu | POST `/{id}/lu` | 200 `{ item: { luLe } }` ; SQL `lu_le` = valeur renvoyée ; rePOST idempotent : même `luLe`, pas de changement ; message d'une autre vitrine : 404 `MESSAGE_INTROUVABLE`. |
| CA17 | UI Studio Messages | déplier le message | point non-lu disparaît, compteur passe de 2 à 1, badge sur /studio mise à jour au retour ; aucune requête inutile (déjà `luLe` ≠ null → pas de POST). |
| CA18 | isolation | utilisateur B lit la liste | aucun message de la vitrine A n'apparaît (PG réel, pattern `reservation-isolation` existant). |

### 8.5 Interactions et pages publiques (e2e)

| # | Given | When | Then |
|---|---|---|---|
| CA19 | visiteur sur `/dr-cabrel` (accueil gelé) | navigation nav **Agenda** | arrive sur `/dr-cabrel/agenda`, h1 unique, fil d'Ariane PC visible, aucun changement visuel de l'accueil (le test asserte que le bloc agenda accueil est inchangé). |
| CA20 | page agenda, 1 service, mois courant | sélection service mois → jour → heure | CTA « Continuer avec {jour} à {heure} » actif, URL cible exacte `/dr-cabrel/reserver?service={slug}&debut={iso}` (le même ISO que GET créneaux) ; après POST: `/dr-cabrel/reserver/confirmation` (flux existant). |
| CA21 | jour sélectionné n'a plus de créneaux après rafraîchissement navigateur | refresh | état vide cohérent, pas d'erreur ; les jours passés/hors-horizon n'activent aucun clic. |
| CA22 | /dr-cabrel/reserver (GET) | accède | **308** vers `/dr-cabrel/agenda` (Location conservé via redirect) ; `/dr-cabrel/reserver?service&debut` valide : page confirmation inchangée (h1 « Plus qu'une étape… »). |
| CA23 | /dr-cabrel/contact | remplissage pas à pas | cartes emails/téléphone/WhatsApp/source des données vitrines ; CTA WhatsApp absent si whatsapp absent (test sur une seed variante), bouton « Voir l'agenda » → /agenda, formulaire complet autant que l'e2e CA12. |
| CA24 | responsive | 390 • 768 • 1280 | aucun débordement horizontal (3 pages publiques + 3 pages studio), cibles ≥ 44 px (calendrier, créneaux, CTA, rangées studio). |
| CA25 | studio `disponibilites` | modification planning + Enregistrer | 1 PUT persisté (SQL réel journalisé), retour à /agenda par le lien « ← Agenda », le seed crée vitrine avec réglages et visuels ; am/pm N'APPARAÎT PAS (les champs affichent 08:00). |
| CA26 | compteurs studio agenda | onglets, header | « {n} à venir · {m} demandes » conforme à l'état réel (PG) ; l'onglet Demandes affiche les demandes et les compteurs d'etiquette. |
| CA27 | seed | `pnpm db:seed` | vitrine `dr-cabrel` : + messages démo (2 non lus, 1 lu), disponibles pour l'UI studio ; pas de nouvelle vitrine. |

---

## 9. Carte des fichiers

Listes **disjointes** backend / frontend ; tests séparés. « (créé)/(modifié) » : tout fichier modifié est **lu intégralement avant modification** (CLAUDE.md §6.2) ; aucun remplacement massif.

### 9.1 Backend (17 fichiers)

**Créés (8)**
1. `server/db/migrations/0017_messages_refus.sql` — table `messages`, index, CHECK statut `refusee`, CHECK outbox élargie (§5).
2. `server/services/messages.ts` — `createMessage` (tx : insert + outbox), `listOwnMessages` (`items` + `nonLus`), `markMessageLu` (idempotent `lu_le`).
3. `server/services/contact-limiteur.ts` — `enforceContactLimit(namespace, username, email, telephone | null)` (mutualisation de la mécanique SHA-256 fail-closed de `reservation-limiteur.ts`, cité tel quel, non réécrit).
4. `server/resources/message.ts` — `toMessageCreatedResource`, `toMessagesStudioResource`, `toMessageLuResource` (zéro ORM cru, champ listés de l'entité imposée §7.6).
5. `server/api/public/[username]/messages/index.post.ts` — route fine : params+IP+limite IP → Zod → limite contact → service → resource, 201.
6. `server/api/studio/messages/index.get.ts` — liste + `nonLus`.
7. `server/api/studio/messages/[id]/lu.post.ts` — marquage lu idempotent.
8. `server/api/studio/reservations/[id]/refuser.patch.ts` — PATCH `refusee` (pattern `confirmer.patch.ts` / `annuler.patch.ts`).

**Modifiés (9) — chaque écart est nommé**
9. `shared/db/schema.ts` — table `messages` ; CHECK `reservations_statut_check` + `refusee` ; CHECK `emails_transactionnels` (`type` + `entite_type` + cohérence) alignées sur 0017.
10. `shared/agenda.ts` — `RESERVATION_STATUTS` + `'refusee'`.
11. `shared/message.ts` — (nouveau) constantes sujets et bornes ; s'agrège à `shared/dto/message.ts` pour types. **(classé backend/shared)**.
12. `shared/schemas/message.ts` — (nouveau) Zod strict.
13. `shared/dto/message.ts` — (nouveau) `MessageCreatedDTO`, `MessageStudioDTO`, `MessagesStudioReponse` ; `shared/dto/index.ts` (cité, +1 ligne export).
14. `shared/erreurs.ts` — `MESSAGE_INTROUVABLE` (404).
15. `shared/limites.ts` — `MESSAGE_PUBLIC_LIMIT {5, 600} », `MESSAGE_CONTACT_LIMIT {3, 86400}`.
16. `shared/jobs.ts` — `TRANSACTIONAL_EMAIL_TYPES` + 2 types (le restant inchangé).
17. `server/services/messages-regles.ts` — `canTransitionReservation` + branche `en_attente → refusee` (refusée terminal) ; cité, modification chirurgicale (une fonction).
18. `server/services/reservations.ts` — `transitionOwnReservation` accepte le cible `refusee` sans `motifAnnulation` (motif seulement pour `annulee`) et **choix du type d'émail** (`reservation_visiteur_refusee` vs `reservation_visiteur_annulee`) ; aucun autre service de réservation n'est retouché.
19. `server/services/email-outbox.ts` — `EmailEntityType` + `'message'`, garde `message_`, loader `loadMessageContent` (JOIN messages → vitrines/users, réutilisation de `professionalRecipient`).
20. `server/services/emails/contenus.ts` — 2 nouveaux modèles renvoyés par `buildTransactionalEmail` (vouvoiement, échappement du contenu identique à celui des `demandes.message`).
21. `server/db/seed.ts` — messages de démo `dr-cabrel` (Marie Ndzi, Paul Essomba non lus / Aïcha Bello lu, dates cronées ré-close à now).

*(± 21 postes ; le compts final pour la session est en §9.4)*

### 9.2 Frontend (18 fichiers)

**Créés (9)**
1. `app/pages/[username]/agenda.vue` — page publique (SSR) : fil d'Ariane, service, calendrier du mois, créneaux, CTA → `/reserver?service&debut`.
2. `app/components/agenda/AgendaReservation.vue` — le corps complet de la page ci-dessus (composant unique réutilisant les helpers de `usePublicAgenda` et les états d'`AgendaPublic.vue` : même vocabulaire d'états).
3. `app/pages/[username]/contact.vue` — page publique Contact (SSR).
4. `app/components/contact/ContactInfos.vue` — cartes coordonnées + WhatsApp + carte réserver.
5. `app/components/contact/ContactMessageForm.vue` — formulaire + honeypot + états.
6. `app/composables/usePublicMessage.ts` — lecture DTIM, POST, erreurs (`useApiErreur`), succès.
7. `app/pages/studio/agenda/disponibilites.vue` — page dédiée (StudioRetour « ← Agenda », dispolib + indispo + réglages + Enregistrer).
8. `app/pages/studio/messages.vue` — liste + dépliage + marque lu (POST `lu`).
9. `app/composables/useStudioMessages.ts` — fetch liste, compteur nonLus, dépliage + POST lu idempotent, états.

**Modifiés (9)**
10. `app/composables/usePublicAgenda.ts` — ajout du mode **page** (bornes mensuelles + regroupement de jour du mois + cache de mois par service) sans toucher à l'API du mode accueil existant (les arguments actuels restent valides — le faux paramètre `jours` reste supporté pour l'accueil gelé).
11. `app/pages/[username]/reserver.vue` — branche « pas de paramètres ou invalides » → redirection 308 vers `/agenda` (préserve la query) ; liens internes (`#agenda` → `/{username}/agenda?…`).
12. `app/components/vitrine/Nav.vue` — liens Agenda → `/agenda`, Contact → `/contact`, bouton Réserver → `/agenda`, `actif` recalculé.
13. `app/composables/useStudioAgenda.ts` — onglets `'a_venir' | 'demandes' | 'passees'` (types/actions/étiquette `Refusée`), scission helpers vers le nouveau `useStudioDisponibilites` (voir 14).
14. `app/composables/useStudioDisponibilites.ts` — (nouveau) : movée par le split codifie au §7.4 : toutes les parties du composable actuel disponibles/incroyables/réglages/enregistrer.
15. `app/components/StudioAgendaActivite.vue` — 3 onglets + titres groupés par jour (« VENDREDI 23 OCTOBRE ») + actions confirmation/refuser et annuler le style maquette.
16. `app/components/StudioAgendaDisponibilites.vue` + `app/components/StudioAgendaIndisponibilites.vue` — ajustement d'implantation pour la page dédiée (espacement, CTA Enregistrer pleine largeur affichée par la page), PropertyChanged lambda update micro — *liste dans le rapport de sprint*.
17. `app/pages/studio/agenda.vue` — nouvelle coquille d'en-tête + onglets ; les <aside> disparaissent (disponibilités déplacées).
18. `app/composables/useStudioNav.ts` — `ECRANS_ENFANTS` + `/studio/agenda/disponibilites`, `/studio/messages` ; nav publique du studio réutilisée.
19. `app/pages/studio/index.vue` — ligne « Messages {n} non lus » dans la liste des lignes avec compteurs.

### 9.3 Tests (11 fichiers)

**Modifiés (4)**
1. `e2e/reservation.spec.ts` — chaque référence `/reserver` parse des chemins : navigation accueil → `/agenda` (CA19), choix créneau → URL `/reserver?…` conservé (le mode confirmation de reserver.vue, pas l'ancienne /reserver pleine) ; assertions h1 « Agenda » du flux ; vérification 308 du GET /reserver sans paramètres.
2. `e2e/capture-agenda.spec.ts` — captures : page `/agenda` (au lieu de /reserver pleine : les visuels d'étape confirmation coûtent moins), confirmation inchangée.
3. `e2e/studio-agenda.spec.ts` — 3 onglets, refuser (201 PG tab) + annulation après refus impossible, header compteurs, accès page Disponibilités (navigation + retour « ← Agenda »), barre du bas masquée.
4. `tests/integration/reservations.test.ts` — CA3/CA4/CA5 statistiques état refusee transitionnel + libération de créneau corrélat entre une réservation `refusee` (PG réel).

**Créés (7)**
5. `tests/integration/messages.test.ts` — création en transaction (messages + outbox atomique), isolation, lu idempotent, `nonLus` (PG réel) : pattern fichier `reservations.test.ts`.
6. `tests/unit/message-schemas.test.ts` — Zod strict : sujet enum,   longueurs du message, telephone E164 ou absent, honeypot, схём identity `id` uuid.
7. `tests/unit/public-message-route.test.ts` — droit d'écriture ordonnée : IP → Zod → limite contact → service (pattern `public-demande-route.test.ts`).
8. `tests/unit/reservations-regles.test.ts` — matrice complète des transitions avec `refusee` (attente → confirmée / annulée / **refusee** ; refuses惱从 invoice terminal ; confirmee → annulée/terminée-auto seulement).
9. `tests/unit/contact-limiteur.test.ts` — clés hachées, échec rejette (`failClosed`), sépar par `username`/ового téléphone, message fonctionne avec `telephone` null (pattern `reservation-limiteur.test.ts`).
10. `e2e/messages.spec.ts` — parcours complet public (CA12/CA23) + studio (CA17) + visiteur non compté deux fois ; purge `limite:*` réutilisée.
11. `tests/unit/schemas-agenda.test.ts` — échéé (cité, enrichi) : `RESERVATION_STATUTS` contient `refusee`.

*(d'échéance des migrations : `tests/integration/migration-0017.test.ts`** (créé) pour prouver sur PG réel : table + CHECK statut refusee + outbox 3 entités + les index partiels `lu_le`. — passe count de 11 à 12; les migrations 0015/0016 ont chacune leur test.)*

### 9.4 Comptage final pour le pipeline

- **Backend : 22 fichiers écrits** (10 créés sans tests, 12 modifiés dont schémas/dto/erreurs/jobs) — la liste exacte ci-dessus.
- **Frontend : 18 fichiers écrits** (9 créés, 9 modifiés).
- **Tests : 12 fichiers** (4 modifiés, 8 créés — dont `migration-0017.test.ts`).
- Listes backend et frontend **disjointes** (aucun fichier partagé sauf le seed côté backend et rien du côté frontend).
- Idées hors périmètre notées pour le rapport : badge WhatsApp sur les notifications, réponses studio, partition mensuelle des messages. Aucune code n'attend d'être écrit pour elles.

---

## 10. Risques & décisions assumées

Les valeurs choisies ici sont **décidées avec une seule ligne de justification** ; les conflits possibles avec le client sont nommés.

1. **URLs des flux** : `/[username]/agenda` = page du flux complet (nouvelle). **Le chemin `/{username}/reserver?service&debut` (mode confirmation) est conservé tel quel** ; le GET `/reserver` sans paramètre devient **308 → `/agenda`** (préservation de méthode et de la query). Justification : la confirmation déjà joliment câblée au cookie `brandself_confirmation` + `private, no-store` + e2e — la déplacer pour l'orthographe serait un risque gratuit. La maquette « Continuez avec… » n'impose pas l'URL. ⚠️ Client : si tu préfères l'homogénéité `/agenda/confirmation`, c'est une migration 0018 de lien ; je préconise NON.
2. **Statut `refusee` (réservations)** : il n'existe PAS aujourd'hui (4 statuts S7). Ajouté en 0017 + `canTransitionReservation`. Justification : la maquette distingue explicitement **Refuser** (en attente) et **Annuler** (confirmée) ; les textes d'email et la sémantique de données diffèrent ; le refus doit libérer le créneau comme l'annulation (exit `STATUTS_BLOQUANTS` et la contrainte partielle GiST ne s'appliquaient déjà qu'aux statuts actifs — aucune migration d'index). Un refus est final ; un « Refuser » ulterérieur est bloqué côté règles mais le créneau reste latex réutilisable (CA4). ⚠️ Client : alternative = réinterpréter le refus comme `annulee` (moins de tables), l'emporte si tu y tiens.
3. **Endpoint calendrier mensuel** : **aucune route nouvelle** ; le client récupère 30-31 jours via l'existante GET créneaux, cache mémoire par mois. Justification : `computeCreneaux` est la source unique de vérité (CLAUDE.md + S7 « ne pas démultiplier »), borné à l'horizon ; une route `/creneaux/mois` doublerait l'invariante précieusement calculée dans le service. ⚠️ Client : si le poids JSON d'un mois devient un souci sur les connexions limitées (marché §2), on ajoutera une route agrégée au bas custo en S12.
4. **Honeypot, pas de piège temporel** : même champ `siteWeb` literally vide, une seule passe de garde. Justification : la demande accepte déjà ce protecteur ; la limite contact SHA-256 provisions le coût réel ; introduce une temporisation créerait une surface de variation de tests peu payante sur les diffuseurs mobiles faibles.
5. **Mapping Contact** : Email=`email_contact` → sinon contact email ; Téléphone=`telefone` ; **WhatsApp = colonne `whatsapp` EXISTANTE de `vitrines`** (S2), aucune colonne à ajouter ; « Cabinet » = ville+pays (`cabinet` est le libellé de la maquette, conservé — voir §11 pour l'alternative « Adresse »). Justification : zéro migration au-delà des messages, la carte WhatsApp masquée si absence.
6. **Sujets du formulaire** : 4 valeurs proposées (`question_avant_reservation`, `demande_information`, `suivi_reservation`, `autre`). **INCONNUES de la maquette** (elle n'en montre qu'une) — flag client avant codage ; le CHECK en base est limité à la liste confirmée, changer la liste est une migration ultérieure triviale.
7. **Emails** : message → **uniquement le professionnel** (mockup : « Répondez directement depuis votre messagerie » ; pas d'accusé au visiteur, l'écran affichant la confirmation visuelle). Justification : S9 gérera la rétention messagerie ; one-source d'emails par événement est la politique §8.3.
8. **Accès Messages dans le Studio** : ligne sur l'**écran Vitrine** (`/studio`) avec badge « {n} non lus » (la maquette « ← Vitrine » rappelle la source) ; **la barre 5 entrées n'est pas touchée** (la maquette la fige). Alternative refusée : 6e onglet (casserait la maquette) ou badge sous l'avatar (maquette douteuse). ⚠️ Client : si tu veux le point dans le menu de l'avatar en plus, c'est +10 lignes studio — ne pas enconce protrusions de la nav PC.
9. **Heures : FR 24 h partout**, la maquette Studio AM/PM est jugée **artefact** (cohérence avec les créneaux publics 45 min déjà en 24 h, la base en `time HH:mm`, l'internationalisation §2). Les champs existants ne sont donc pas réécrits : la conformité se limite à leur remetagning dans la page dédiée.
10. **La couleur bleue des maquettes** (jours disponibles, écriture chiffres) : remplacée par les tokens (texte accent/encre selon l'état) ; aucune valeur hexadécimale n'entre dans les composants (CLAUDE.md §5). Le jour **sélectionné** en aplat accent + texte `sur-accent` (contraste déjà garanti par la palette).
11. **Le « en_attente » n'expire pas** (HIGH-2 rejeté post-S7, PROJECT_STATE §7) : le refus et le refus-like sont spontanément gérés par les actions du professionnel ; aucune auto-annulation n'est écrite pour S7-bis. Les limites `en_attente` sans OTP restent la dette S8/S13 existante.
12. **Sécurité/type** : le message est rendu en **texte pur** — l'email le transmet échappé (mêmes garde-fous que `demandes.message`), la UI l'affiche via interpolation (aucun `v-html`), le stockage contient le texte brut ; aucune URL n'est clickifiée au studio (pas de RLS/type injection).

---

## 11. Questions ouvertes pour le client (proposition par défaut entre parenthèse)

> **Tranché le 2026-10-31 par le client — ces 5 points ne sont plus des questions :**
> 1. Sujets : les 4 proposés (`question_avant_reservation`, `demande_information`, `suivi_reservation`, `autre`).
> 2. Libellé « Cabinet » conservé.
> 3. Deux statuts distincts : `refusee` + `annulee`, e-mails différents.
> 4. Aucun accusé au visiteur du Contact (la confirmation visuelle suffit) ; S9 tranchera la messagerie.
> 5. Accès Messages : ligne sur l'écran Vitrine + badge ; pas de point sous l'avatar ; la barre du bas à 5 onglets est intouchée.
