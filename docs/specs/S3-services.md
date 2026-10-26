# Spec S3 : Services (base, API, studio, pages publiques)

Spec rédigée par l'architect le 2026-10-26, en lecture seule (aucun fichier modifié). Tier standard. Le domaine ne touche ni l'auth, ni le paiement, ni de données personnelles nouvelles : pas d'escalade de tier.

À écrire dans `docs/specs/S3-services.md`.

**Sources lues** : CLAUDE.md, PROJECT_CONTEXT.md (§4, 4.1, 4.2, 5, 6, 8.1, 9, 10, 11, 15), PROJECT_STATE.md, SPRINTS.md (S3), docs/specs/S2-backend.md, `shared/db/schema.ts`, migrations 0003 et 0009 et `_journal.json`, `shared/**`, `server/**` (services, resources, utils, exceptions, routes), `app/**` (pages services, `[username].vue`, composables, composants vitrine et studio, layout), seed, `tests/unit/routes-convention.test.ts`, `e2e/api/studio-auth.spec.ts`, la fabrique `insertService`.

**Maquettes lues** (PNG) : `Studio · Services`, `Studio · Modifier un service`, `Service · Mobile`, `Service · PC`, `Page Services · PC`, `Vitrine · Terracotta` (mobile), `Vitrine · Tablette`, `Vitrine · PC`, `Studio`.

---

## CHALLENGE

**Hypothèses implicites**
- Le brief dit « S3 existe déjà ». En réalité, presque rien n'est réutilisable : schéma sans contraintes, routes inatteignables, aucune couche service, UI hors maquettes. C'est une **réécriture**.
- Il demande « limites de plan via PlanService ». Or SPRINTS S3 met explicitement les limites du plan gratuit hors périmètre, et il n'existe ni table `abonnements`, ni `PlanService`.
- Le « max 3 en vedette » est une **règle produit** (§4.2), pas une limite de plan. Il va dans une constante partagée, pas dans PlanService.

**Angles morts trouvés (absents du brief)**
1. **CRITIQUE : `app/pages/[username].vue` avale toutes les pages publiques.**
   - Ce fichier coexiste avec le dossier `app/pages/[username]/`. Nuxt en fait une route parente.
   - Il n'a pas de `<NuxtPage />`, donc `/dr-cabrel/services` et `/dr-cabrel/services/x` affichent l'accueil. Les pages enfants ne s'affichent jamais.
   - Correction : déplacer le fichier vers `app/pages/[username]/index.vue`.
2. **Les ids du seed ne sont pas des UUID** (`seed-svc-consultation`). Ils sont incompatibles avec une route studio `[id]` validée en uuid : les services de démo ne seraient pas modifiables.
3. **Le seed contient des prix inventés** (15 000, 35 000…), alors que §15 dit « aucun chiffre inventé ».
4. **La maquette du formulaire montre 3 modes de règlement**, « Au choix du client » coché. PROJECT_CONTEXT §4.1 masque `en_ligne` et `au_choix` en v1 (drapeau `PAIEMENT_EN_LIGNE=false`), et ce drapeau n'existe nulle part dans le code.
5. **Défauts de la base actuelle** :
   - `services_slug_idx` est global et non unique ;
   - `image_media_id` n'a pas de clé étrangère ;
   - `duree_min` est NOT NULL, alors qu'une prestation sur devis n'a pas de durée obligatoire ;
   - aucun CHECK sur type, tarif ou cohérence du prix.
6. **Une mise à jour partielle (PUT) doit être validée sur l'état fusionné** (base + modification). Exemple : passer `type` à `accompagnement` sans `nbSeances`. Une validation Zod du seul corps ne suffit pas.
7. **Concurrence sur le plafond de 3 vedettes** : deux requêtes simultanées peuvent passer le comptage. Il faut un verrou.
8. **« Masqué » et « en vedette » ensemble** : il faut une sémantique. Un service masqué occupe-t-il une place en vedette ?
9. **Slugify** : `&` devient `and` par défaut, et `œ` doit être translittéré. Une bibliothèque est nécessaire et doit être configurée.
10. **`server/api/public/services.get.ts` masque `/api/public/:username`** pour le username `services`. Ce fichier est à supprimer.
11. **Prix en EUR/USD** : « entier » implique des centimes. La saisie et l'affichage doivent convertir.
12. **`useStudioNav`** ne masque la barre du bas que sur des chemins exacts. Le formulaire de service (sans barre du bas sur la maquette) n'est pas couvert.
13. **Routes `[slug]` côté studio** : un service intitulé « Réordonner » aurait le slug `reordonner` et entrerait en collision avec `POST /services/reordonner`.

**Meilleure approche retenue**
- Studio en `[id]` (uuid), public en `[slug]`.
- Pas de routes `PATCH …/visibilite` ni `…/vedette` : un seul `PUT` partiel (patron S2) porte toutes les règles. Moins de fichiers, une seule logique.
- Règles doublées par des CHECK en base.
- Verrou `FOR UPDATE` sur la ligne vitrine pour la vedette, le slug et l'ordre.
- Une seule réponse publique `{ total, aLaUne, services }` pour l'accueil et la page Services. Le DTO S2 `/api/public/:username` reste inchangé.

**À retirer ou simplifier**
- Routes PATCH (remplacées par le PUT partiel).
- PlanService (S10).
- « Prochains créneaux » et « Première séance » (S7).
- Pas de bibliothèque de carrousel côté public : `scroll-snap` CSS natif, sans JS sur les pages publiques mobiles.
- La page `/[username]/reserver` reste provisoire et minimale.

**Périmètre réel en plus du brief**
- Déplacement `[username].vue` → `[username]/index.vue`.
- `vitrine/Nav.vue` (lien Services) et nouveau cadre commun des pages publiques.
- `useStudioNav.ts`, seed, test U8 de convention de routes, `e2e/api/studio-auth.spec.ts`.
- Drapeau `PAIEMENT_EN_LIGNE` (`shared/env.ts`, `nuxt.config.ts`, `.env.example`).
- `server/exceptions/http.ts` (messages).

### Changements par rapport au brief littéral
| Brief ou SPRINTS | Retenu | Raison |
|---|---|---|
| `PATCH …/visibilite`, `PATCH …/vedette` | supprimés, `PUT /services/:id` partiel | une seule logique, patron S2, moins de surface |
| limites de plan via PlanService | non implémentées en S3, aucun PlanService créé | SPRINTS S3 les exclut, aucune table `abonnements` ; le point d'insertion S10 est documenté (§10) |
| `[id]` ou `[slug]` à trancher | studio `[id]`, public `[slug]` | voir §2 |
| « Ce que comprend » | colonne `inclus text[]` | SPRINTS S3, absent de la maquette studio |
| 3 modes de règlement (maquette) | seul « Sur place » proposé, plus des instructions de règlement | PROJECT_CONTEXT §4.1, drapeau `PAIEMENT_EN_LIGNE=false` |

---

## 0. Décisions par défaut (à confirmer par l'utilisateur)

| # | Sujet | Défaut |
|---|---|---|
| 23 | Paramètre des routes studio | `[id]` uuid ; public `[username]/services/[slug]` |
| 24 | Bascule visibilité et vedette | `PUT /api/studio/services/:id` partiel, pas de PATCH |
| 25 | Masquer un service en vedette | le retire de la vedette (CHECK `NOT en_vedette OR actif`) ; impossible de mettre en vedette un service masqué |
| 26 | Accueil sans aucun service en vedette | repli : les 3 premiers visibles (ordre) ; jamais de section vide si des services existent |
| 27 | Slug | généré depuis le titre à la création, **jamais modifié** ensuite, non éditable ; collision → `-2`, `-3`… ; max 80 ; repli `service` |
| 28 | Unité des prix | plus petite unité ISO 4217 : XAF 0 décimale (francs), EUR/USD 2 décimales (centimes) ; max `1 000 000 000` |
| 29 | Affichage du prix | `Intl.NumberFormat('fr-FR')` ; XAF en code (« 15 000 XAF », comme la maquette) ; EUR/USD en symbole (« 12,50 € ») |
| 30 | Devise | par service, présélectionnée sur la devise du compte (`/api/studio/moi`) ; liste `DEVISES` (XAF, EUR, USD) |
| 31 | Type `devis` | impose `tarif='devis'` ; durée facultative (seul type où elle l'est) |
| 32 | Rythme (accompagnement) | liste fermée : `hebdomadaire`, `bimensuel`, `mensuel`, `libre` ; facultatif |
| 33 | Paiement | `PAIEMENT_EN_LIGNE=false` : seul `sur_place` proposé ; l'API refuse `en_ligne`/`au_choix` (422) ; le DTO public force `sur_place` |
| 34 | `reservable=false` | carte : bouton « Voir le détail » ; détail : « Me contacter » (WhatsApp sinon `#contact`) |
| 35 | Cible du bouton d'action en S3 | `/[username]/reserver?service=<slug>`, page provisoire `noindex` avec les moyens de contact ; remplacée en S7 |
| 36 | Plan gratuit (3 services) | non appliqué en S3 (seed : 6 services) ; S10 |
| 37 | Prix du seed | les valeurs de travail actuelles restent, **signalées** (§15 interdit les chiffres inventés) : Cabrel fournit les vrais montants ou valide |
| 38 | 4e vedette | **409** `VEDETTE_COMPLETE` + `data.enVedette` (liste à retirer) |
| 39 | « Autres services » sur le détail | 2 au maximum (maquette mobile) + lien « Voir tous les services (n) » |
| 40 | Réordonnancement studio | poignée de glisser (`@vueuse/integrations/useSortable` + `sortablejs`) + clavier (flèches sur la poignée) ; écart maquette (poignée absente) |
| 41 | Après « Enregistrer » | retour à la liste `/studio/services` |
| 42 | Titre de la liste « inclus » (public) | accompagnement : « Le programme » (numéroté 01, 02…) ; autres types : « Ce que comprend ce service » (coches) |
| 43 | Slugify | `@sindresorhus/slugify` avec `customReplacements: [['&', ' et ']]`, `decamelize:false` |
| 44 | Ids du seed | UUID fixes ; le seed supprime les services de la vitrine de démo absents de sa liste |
| 45 | Bouton du haut « Réserver » (maquettes publiques) | reste « Me contacter » jusqu'à S7 (écart noté) |

## 1. Constats confirmés (audit)

**Routes studio**
- `services.[slug].{get,put,delete}.ts` : le point n'est pas un séparateur Nitro. Ces routes sont inatteignables (404) et figurent dans les exceptions de U8.
- Aucune ne passe par `defineApiHandler`, ni par un service, ni par une ressource.
- `services.post.ts` renvoie la ligne ORM brute (`vitrineId`…) et `statusMessage` accentué.
- POST accepte `slug`, `ordre`, `enVedette` sans plafond de vedettes.

**Routes publiques**
- `public/services.get.ts` et `public/services/[slug].get.ts` lisent `params.username`, qui n'existe pas dans ces chemins.
- Elles renvoient des lignes brutes.
- La première masque `/api/public/:username` pour `services`.

**Schéma**
- `services_slug_idx` est global et non unique ; pas d'unicité par vitrine.
- Pas de FK sur `image_media_id`.
- `duree_min` NOT NULL.
- Aucun CHECK (type, tarif, devise, cohérence prix/tarif, vedette/visibilité).
- Pas de colonne `inclus`.

**Pages**
- Interfaces locales, pas de DTO partagés, `fetch` brut, `confirm()`, `console.log` (TODO vedette/actif).
- `BsTopNav`/`BsBottomNav` en double avec le layout studio, CSS maison hors `@nuxt/ui`.
- `select`/`input` natifs, aucun interrupteur de visibilité fonctionnel.
- `NuxtLink to="/"` au lieu de la vitrine.
- Pages publiques non montées (constat CHALLENGE n°1).
- `studio/services/nouveau.vue` envoie `titre` (Ref) au lieu de `titre.value`.

**Seed**
- Ids non UUID, prix inventés, `rythme: 'Hebdomadaire'` (texte libre), une seule vedette.
- Descriptions différentes des maquettes.

## 2. Convention de routes (rappel S2 §2, appliquée)

Un dossier par ressource : `index.<m>.ts` pour la collection, `[id].<m>.ts` pour un élément, `<action>.<m>.ts` pour une action. **Jamais de point avant un crochet.**

- Studio : `[id]` (uuid).
  - Identifiant stable, validé sans requête.
  - Aucune collision possible avec les actions statiques (`reordonner`).
  - Indépendant du slug (SEO).
- Public : `[username]/services/[slug]`, car le slug sert le SEO.

**À supprimer**
- `server/api/studio/services.get.ts`
- `server/api/studio/services.post.ts`
- `server/api/studio/services.[slug].get.ts`
- `server/api/studio/services.[slug].put.ts`
- `server/api/studio/services.[slug].delete.ts`
- `server/api/public/services.get.ts`
- `server/api/public/services/[slug].get.ts` (et le dossier `server/api/public/services/`)

**À créer**
- `server/api/studio/services/index.get.ts`
- `server/api/studio/services/index.post.ts`
- `server/api/studio/services/[id].get.ts`
- `server/api/studio/services/[id].put.ts`
- `server/api/studio/services/[id].delete.ts`
- `server/api/studio/services/reordonner.post.ts`
- `server/api/public/[username]/services/index.get.ts`
- `server/api/public/[username]/services/[slug].get.ts`

**Test U8** (`tests/unit/routes-convention.test.ts`) : retirer l'entrée `S3` de `EXCEPTIONS_PAR_SPRINT` et passer `PLAFOND_EXCEPTIONS` de 12 à **9**.

## 3. Migration `0010_s3_services.sql`

0003 reste intacte. Le prochain numéro est bien 0010 (journal : idx 9 = `0009_s2_vitrines_medias`).

**Procédure** (identique à S2)
1. Modifier `shared/db/schema.ts`.
2. Lancer `pnpm db:generate --name s3_services`.
3. **Remplacer** le SQL généré par celui ci-dessous, en gardant `meta/0010_snapshot.json` aligné sur schema.ts.
4. Un second `db:generate` doit répondre « No schema changes ».
5. Tester up → down (bloc ROLLBACK appliqué à la main) → up sur la base de test.

```sql
-- 1. Colonnes
ALTER TABLE services ALTER COLUMN duree_min DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE services ADD COLUMN inclus text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
-- 2. Remise en conformité des données existantes (développement), AVANT les contraintes
UPDATE services SET type = 'rdv' WHERE type NOT IN ('rdv','accompagnement','atelier','devis');
UPDATE services SET tarif = 'devis' WHERE type = 'devis' OR tarif NOT IN ('gratuit','payant','devis');
UPDATE services SET tarif = 'devis' WHERE tarif = 'payant' AND (prix_montant IS NULL OR prix_montant <= 0);
UPDATE services SET prix_devise = 'XAF' WHERE tarif = 'payant' AND (prix_devise IS NULL OR prix_devise NOT IN ('XAF','EUR','USD'));
UPDATE services SET prix_montant = NULL, prix_devise = NULL, paiement_mode = NULL, paiement_instructions = NULL WHERE tarif <> 'payant';
UPDATE services SET paiement_mode = 'sur_place' WHERE tarif = 'payant' AND (paiement_mode IS NULL OR paiement_mode NOT IN ('en_ligne','sur_place','au_choix'));
UPDATE services SET rythme = CASE WHEN lower(rythme) LIKE 'hebdo%' THEN 'hebdomadaire' WHEN lower(rythme) LIKE 'mensu%' THEN 'mensuel' ELSE NULL END WHERE rythme IS NOT NULL;
UPDATE services SET nb_seances = NULL, rythme = NULL WHERE type <> 'accompagnement';
UPDATE services SET nb_seances = GREATEST(2, LEAST(52, COALESCE(nb_seances, 2))) WHERE type = 'accompagnement';
UPDATE services SET duree_min = GREATEST(5, LEAST(1440, COALESCE(duree_min, 30))) WHERE type <> 'devis';
UPDATE services SET duree_min = NULL WHERE type = 'devis' AND (duree_min < 5 OR duree_min > 1440);
UPDATE services SET ordre = 0 WHERE ordre < 0;
UPDATE services SET en_vedette = false WHERE actif = false;
UPDATE services s SET en_vedette = false FROM (
  SELECT id, row_number() OVER (PARTITION BY vitrine_id ORDER BY ordre, created_at, id) AS rang
  FROM services WHERE en_vedette) v
WHERE s.id = v.id AND v.rang > 3;
UPDATE services s SET image_media_id = NULL WHERE image_media_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM medias m JOIN vitrines v ON v.user_id = m.user_id
  WHERE m.id = s.image_media_id AND v.id = s.vitrine_id);
UPDATE services SET slug = 'service-' || substr(md5(id), 1, 8)
  WHERE char_length(slug) NOT BETWEEN 1 AND 80 OR slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
UPDATE services s SET slug = rtrim(left(s.slug, 71), '-') || '-' || substr(md5(s.id), 1, 8)
  WHERE EXISTS (SELECT 1 FROM services o WHERE o.vitrine_id = s.vitrine_id AND o.slug = s.slug AND o.id < s.id);
--> statement-breakpoint
-- 3. Index : unicité PAR vitrine (couvre aussi les recherches par vitrine_id)
DROP INDEX IF EXISTS services_slug_idx;
DROP INDEX IF EXISTS services_actif_idx;
DROP INDEX IF EXISTS services_vitrine_id_idx;
CREATE UNIQUE INDEX services_vitrine_id_slug_unique ON services (vitrine_id, slug);
--> statement-breakpoint
-- 4. Image = ligne medias
ALTER TABLE services ADD CONSTRAINT services_image_media_id_medias_id_fk
  FOREIGN KEY (image_media_id) REFERENCES medias(id) ON DELETE SET NULL;
CREATE INDEX services_image_media_id_idx ON services (image_media_id);
--> statement-breakpoint
-- 5. Contraintes (listes recopiées : source applicative shared/services.ts et shared/compte.ts)
ALTER TABLE services
  ADD CONSTRAINT services_type_check CHECK (type IN ('rdv','accompagnement','atelier','devis')),
  ADD CONSTRAINT services_tarif_check CHECK (tarif IN ('gratuit','payant','devis')),
  ADD CONSTRAINT services_paiement_mode_check CHECK (paiement_mode IS NULL OR paiement_mode IN ('en_ligne','sur_place','au_choix')),
  ADD CONSTRAINT services_rythme_check CHECK (rythme IS NULL OR rythme IN ('hebdomadaire','bimensuel','mensuel','libre')),
  ADD CONSTRAINT services_prix_devise_check CHECK (prix_devise IS NULL OR prix_devise IN ('XAF','EUR','USD')),
  ADD CONSTRAINT services_prix_montant_check CHECK (prix_montant IS NULL OR prix_montant BETWEEN 1 AND 1000000000),
  ADD CONSTRAINT services_duree_min_check CHECK (duree_min IS NULL OR duree_min BETWEEN 5 AND 1440),
  ADD CONSTRAINT services_nb_seances_check CHECK (nb_seances IS NULL OR nb_seances BETWEEN 2 AND 52),
  ADD CONSTRAINT services_ordre_check CHECK (ordre >= 0),
  ADD CONSTRAINT services_slug_format_check CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT services_inclus_check CHECK (cardinality(inclus) <= 12),
  ADD CONSTRAINT services_duree_requise_check CHECK (type = 'devis' OR duree_min IS NOT NULL),
  ADD CONSTRAINT services_seances_type_check CHECK ((type = 'accompagnement') = (nb_seances IS NOT NULL)),
  ADD CONSTRAINT services_rythme_type_check CHECK (rythme IS NULL OR type = 'accompagnement'),
  ADD CONSTRAINT services_devis_tarif_check CHECK (type <> 'devis' OR tarif = 'devis'),
  ADD CONSTRAINT services_prix_tarif_check CHECK ((tarif = 'payant') = (prix_montant IS NOT NULL AND prix_devise IS NOT NULL)),
  ADD CONSTRAINT services_paiement_tarif_check CHECK ((tarif = 'payant') = (paiement_mode IS NOT NULL)),
  ADD CONSTRAINT services_vedette_actif_check CHECK (NOT en_vedette OR actif);

-- ROLLBACK (à appliquer à la main ; les normalisations de données ne sont pas réversibles)
-- ALTER TABLE services DROP CONSTRAINT services_type_check, DROP CONSTRAINT services_tarif_check,
--   DROP CONSTRAINT services_paiement_mode_check, DROP CONSTRAINT services_rythme_check,
--   DROP CONSTRAINT services_prix_devise_check, DROP CONSTRAINT services_prix_montant_check,
--   DROP CONSTRAINT services_duree_min_check, DROP CONSTRAINT services_nb_seances_check,
--   DROP CONSTRAINT services_ordre_check, DROP CONSTRAINT services_slug_format_check,
--   DROP CONSTRAINT services_inclus_check, DROP CONSTRAINT services_duree_requise_check,
--   DROP CONSTRAINT services_seances_type_check, DROP CONSTRAINT services_rythme_type_check,
--   DROP CONSTRAINT services_devis_tarif_check, DROP CONSTRAINT services_prix_tarif_check,
--   DROP CONSTRAINT services_paiement_tarif_check, DROP CONSTRAINT services_vedette_actif_check;
-- DROP INDEX services_image_media_id_idx;
-- ALTER TABLE services DROP CONSTRAINT services_image_media_id_medias_id_fk;
-- DROP INDEX services_vitrine_id_slug_unique;
-- CREATE INDEX services_vitrine_id_idx ON services (vitrine_id);
-- CREATE INDEX services_slug_idx ON services (slug);
-- CREATE INDEX services_actif_idx ON services (actif);
-- ALTER TABLE services DROP COLUMN inclus;
-- UPDATE services SET duree_min = 30 WHERE duree_min IS NULL;
-- ALTER TABLE services ALTER COLUMN duree_min SET NOT NULL;
```

**`shared/db/schema.ts`, table `services`**
- `imageMediaId.references(() => medias.id, { onDelete: 'set null' })`
- `dureeMin` nullable
- `inclus: text('inclus').array().notNull().default([])`
- index : `uniqueIndex('services_vitrine_id_slug_unique').on(vitrineId, slug)` et `index('services_image_media_id_idx')`
- les 18 `check()` ci-dessus, en expressions SQL identiques
- suppression des 3 anciens index
- commentaire « listes synchronisées avec shared/services.ts »

**Seed (`server/db/seed.ts`)**

UUID fixes pour les 6 services. Tous sont actifs ; vedettes = Consultation, Bilan, Suivi.

| Service | Type | Durée | Tarif | Photo | Inclus |
|---|---|---|---|---|---|
| Consultation de cardiologie | rdv | 45 min | payant | oui | 3 lignes de la maquette `Service · Mobile` |
| Bilan cardiovasculaire complet | rdv | 60 min | payant | oui | — |
| Suivi après infarctus | accompagnement | 6 × 30 min, `hebdomadaire` | payant | non | les 6 lignes du programme de `Service · PC` |
| Échographie cardiaque | rdv | 30 min | payant | oui | — |
| Téléconsultation | rdv | 20 min | gratuit | non | — |
| Second avis | devis | 40 min | devis | non | — |

- Descriptions reprises des maquettes.
- Les 3 photos de démonstration sont **générées par sharp** au moment du seed (aplat de couleur, aucun binaire commité) et téléversées via `uploadMedia`. Le seed est idempotent : il réutilise l'image existante si le service en a déjà une.
- Le seed supprime d'abord les services de la vitrine de démo dont l'id n'est pas dans la liste (anciens ids non UUID).
- Prix : décision #37.

## 4. Contrats partagés (`shared/`)

### `shared/services.ts` (nouveau, pur, sans dépendance serveur)

**Listes et types**
- `SERVICE_TYPES = ['rdv','accompagnement','atelier','devis'] as const`, type `ServiceType`
- `TARIFS = ['gratuit','payant','devis']`, type `Tarif`
- `PAIEMENT_MODES = ['en_ligne','sur_place','au_choix']`, type `PaiementMode`
- `PAIEMENT_MODES_HORS_LIGNE = ['sur_place']`
- `RYTHMES = ['hebdomadaire','bimensuel','mensuel','libre']`, type `Rythme`

**Constantes**
- `VEDETTE_MAX = 3`
- `SERVICE_TITRE_MAX = 80`, `SERVICE_DESCRIPTION_MAX = 1000`, `PAIEMENT_INSTRUCTIONS_MAX = 500`
- `INCLUS_MAX = 12`, `INCLUS_LIGNE_MAX = 160`
- `DUREE_MIN_MIN = 5`, `DUREE_MIN_MAX = 1440`
- `SEANCES_MIN = 2`, `SEANCES_MAX = 52`
- `SERVICE_SLUG_MAX = 80`, `SERVICE_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/`
- `AUTRES_SERVICES_MAX = 2`, `SERVICES_REORDER_MAX = 200`
- `DUREE_REQUISE: Record<ServiceType, boolean>` = `{rdv:true, accompagnement:true, atelier:true, devis:false}`

**Tables de libellés (uniques, SPRINTS : « une table de correspondance unique »)**
- `SERVICE_TYPE_PASTILLES` : `{rdv:'Rendez-vous', accompagnement:'Accompagnement', atelier:'Atelier', devis:'Prestation'}`
- `SERVICE_TYPE_LIBELLES` (formulaire) : `{rdv:'Rendez-vous ponctuel', accompagnement:'Accompagnement (plusieurs séances)', atelier:'Atelier ou formation (groupe)', devis:'Prestation sur devis'}`
- `SERVICE_ACTIONS: Record<ServiceType,{court,long}>` :
  - rdv : `Réserver` / `Réserver`
  - accompagnement : `Réserver la 1re séance` / `Réserver la première séance`
  - atelier : `S'inscrire` / `S'inscrire`
  - devis : `Demander un devis` / `Demander un devis`
- `TARIF_LIBELLES` : `{gratuit:'Gratuit', payant:'Payant', devis:'Sur devis'}`
- `RYTHME_LIBELLES` : `{hebdomadaire:'Une séance par semaine', bimensuel:'Une séance toutes les deux semaines', mensuel:'Une séance par mois', libre:'À convenir ensemble'}`
- `RYTHME_PHRASES` : `{hebdomadaire:'une par semaine', bimensuel:'une toutes les deux semaines', mensuel:'une par mois', libre:'à un rythme convenu ensemble'}`
- `PAIEMENT_MODE_LIBELLES: Record<PaiementMode,{titre,description}>` (textes de la maquette ; pour `sur_place` : « Sur place, à la séance » / « Le client règle directement auprès de vous. »)

**Fonctions pures**
- `formatDureeCourte(min)` → `'45 min'`
- `formatDureeLongue(min)` → `'45 minutes'`
- `resumeSeancesCourt(nb, duree)` → `'6 séances · 30 min'`
- `resumeSeancesLong(nb, duree, rythme)` → `'6 séances de 30 minutes, une par semaine'`
- `metaStudio(s)` → `'Rendez-vous · 45 min · Payant'` | `'Accompagnement · 6 séances · Payant'` | `'Sur devis'` ; suffixe `' · Masqué'` si `!actif`
- `libellePrix(s)` → `'Gratuit'` | `'Sur devis'` | `formatPrix(...)`, préfixé de `'Forfait '` pour un accompagnement payant
- `initialeDuTitre(titre)` → première lettre en majuscule, accent conservé (`'É'`)
- `serviceActionHref(username, slug)` → `/${username}/reserver?service=${slug}`
- `serviceDetailHref(username, slug)`

### `shared/devises.ts` (nouveau)
- `DEVISE_DECIMALES: Record<Devise, number> = {XAF:0, EUR:2, USD:2}`
- `DEVISE_AFFICHAGE: Record<Devise,'code'|'symbol'> = {XAF:'code', EUR:'symbol', USD:'symbol'}`
- `PRIX_MAX_MINOR = 1_000_000_000`
- `formatPrix(minor, devise)` : Intl fr-FR, `currencyDisplay` selon la devise
- `toMajorUnits(minor, devise)` → `'150.00'` (JSON-LD)
- `parsePrixSaisi(texte, devise): number | null` :
  - `'15 000'` (XAF) → `15000`
  - `'12,50'` (EUR) → `1250`
  - plus de décimales que permis, négatif ou non numérique → `null`
- `formatPrixSaisi(minor, devise)` : valeur initiale du champ

### `shared/schemas/service.ts` (réécrit)

Préprocesseur `blankToNull` (comme vitrine).

**`champs`**
- `titre` : trim, 1 à 80
- `description` : nullable, ≤ 1000
- `imageMediaId` : `z.uuid().nullable()`
- `type` : enum
- `nbSeances` : `z.int().min(2).max(52).nullable()`
- `rythme` : enum, nullable
- `dureeMin` : `z.int().min(5).max(1440).nullable()`
- `tarif` : enum
- `prixMontant` : `z.int().min(1).max(PRIX_MAX_MINOR).nullable()`
- `prixDevise` : `z.enum(DEVISES).nullable()`
- `paiementMode` : enum, nullable
- `paiementInstructions` : nullable, ≤ 500
- `inclus` : préprocesseur (rogne chaque ligne, retire les vides) puis `z.array(z.string().max(160)).max(12)`
- `reservable`, `enVedette`, `actif` : `z.boolean()`

**Schémas**
- `schemaServiceCreate = z.object(champs avec défauts : description/imageMediaId/nbSeances/rythme/dureeMin/prix*/paiement* → null, inclus → [], reservable → true, actif → true, enVedette OPTIONNEL sans défaut (= automatique)).strict()`
- `schemaServiceUpdate = z.object(champs).partial().strict().refine(non vide, 'Aucune modification à enregistrer.')`
- `schemaServiceReorder = z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict().refine(sans doublon)`
- `slug`, `ordre`, `vitrineId`, `id` sont **interdits** (strict → 400).
- Types exportés : `ServiceCreateInput`, `ServiceUpdateInput`, `ServiceReorderInput`.

La cohérence entre champs n'est **pas** dans Zod : elle est évaluée côté serveur sur l'état fusionné (§6).

### `shared/dto/service.ts` (nouveau, types seulement) et ré-exports dans `shared/dto/index.ts`

```ts
ServiceStudioDTO { id; slug; titre; description: string|null; image: MediaDTO|null; type: ServiceType;
  nbSeances: number|null; rythme: Rythme|null; dureeMin: number|null; tarif: Tarif;
  prixMontant: number|null /*unité mineure*/; prixDevise: Devise|null; paiementMode: PaiementMode|null;
  paiementInstructions: string|null; inclus: string[]; reservable; enVedette; actif; ordre; creeLe; modifieLe }
ServicesCompteursDTO { total; visibles; enVedette; vedetteMax }
ServicePublicCarteDTO { slug; titre; description; image: MediaDTO|null; type; nbSeances; rythme; dureeMin;
  tarif; prixMontant; prixDevise; reservable }
ServicePublicDetailDTO extends ServicePublicCarteDTO { paiementMode: PaiementMode|null /*effectif*/;
  paiementInstructions: string|null; inclus: string[]; seo: { titre; description } }
// Réponses
ServicesStudioReponse { services: ServiceStudioDTO[]; compteurs: ServicesCompteursDTO }
ServiceStudioReponse  { service: ServiceStudioDTO; compteurs: ServicesCompteursDTO }
ServicesPublicsReponse { total: number; aLaUne: ServicePublicCarteDTO[]; services: ServicePublicCarteDTO[] }
ServicePublicReponse  { service: ServicePublicDetailDTO; autres: ServicePublicCarteDTO[]; total: number }
```

Le DTO public ne contient **jamais** : `id`, `vitrineId`, `ordre`, `actif`, `enVedette`, dates, chemin disque.

### `shared/erreurs.ts`

Ajouter les codes suivants à `ERROR_CODES`/`ERROR_STATUS` :
- `SERVICE_INTROUVABLE` (404)
- `VEDETTE_COMPLETE` (409)
- `ORDRE_INVALIDE` (422)
- `PAIEMENT_EN_LIGNE_INDISPONIBLE` (422)

`ErrorData` reçoit `enVedette?: { id: string; titre: string }[]`.

### Autres fichiers du lot contrats
- **`server/exceptions/http.ts`** (`ERROR_MESSAGES`, dans le lot L1 pour garder le typecheck vert) :
  - `SERVICE_INTROUVABLE` : « Ce service est introuvable. »
  - `VEDETTE_COMPLETE` : `` `Vous avez déjà ${VEDETTE_MAX} services en vedette. Retirez-en un pour mettre celui-ci en avant.` ``
  - `ORDRE_INVALIDE` : « L'ordre envoyé ne correspond plus à vos services. Rechargez la page et réessayez. »
  - `PAIEMENT_EN_LIGNE_INDISPONIBLE` : « Le paiement en ligne n'est pas encore disponible. Choisissez le règlement sur place. »
- **`shared/env.ts`** : `PAIEMENT_EN_LIGNE: z.stringbool().default(false)` ; `DrapeauxPublics.paiementEnLigne` dérivé dans `loadDrapeauxPublics`.
- **`nuxt.config.ts`** : `runtimeConfig.public.paiementEnLigne`.
- **`.env.example`** : `PAIEMENT_EN_LIGNE=false`.
- **`package.json`** : `@sindresorhus/slugify`, `@vueuse/integrations`, `sortablejs`, `@types/sortablejs` (dev).

## 5. Contrats API

Format d'erreur identique à S2 §5. Toutes les routes `/api/studio/**` répondent 401 sans session. Aucune route ne renvoie un objet ORM.

| Méthode, chemin | Corps | Succès | Erreurs |
|---|---|---|---|
| GET `/api/studio/services` | — | 200 `ServicesStudioReponse` (tri `ordre`, puis `creeLe`, puis `id` ; masqués inclus) | 404 VITRINE_INTROUVABLE |
| POST `/api/studio/services` | `schemaServiceCreate` | **201** `ServiceStudioReponse` | 400 VALIDATION (`champs`), 404 VITRINE_INTROUVABLE, 409 VEDETTE_COMPLETE (`enVedette`), 422 MEDIA_INVALIDE, 422 PAIEMENT_EN_LIGNE_INDISPONIBLE |
| GET `/api/studio/services/:id` | — | 200 `ServiceStudioReponse` | 400 (id non uuid), 404 SERVICE_INTROUVABLE / VITRINE_INTROUVABLE |
| PUT `/api/studio/services/:id` | `schemaServiceUpdate` (partiel) | 200 `ServiceStudioReponse` | 400, 404, 409 VEDETTE_COMPLETE, 422 MEDIA_INVALIDE / PAIEMENT_EN_LIGNE_INDISPONIBLE |
| DELETE `/api/studio/services/:id` | — | **204** | 400, 404 |
| POST `/api/studio/services/reordonner` | `{ ids: uuid[] }` (permutation exacte de TOUS les services de la vitrine) | 200 `ServicesStudioReponse` | 400, 404, 422 ORDRE_INVALIDE |
| GET `/api/public/:username/services` | — | 200 `ServicesPublicsReponse` (vitrine publiée ; visibles seulement ; 200 avec listes vides si aucun) | 404 VITRINE_INTROUVABLE |
| GET `/api/public/:username/services/:slug` | — | 200 `ServicePublicReponse` | 404 VITRINE_INTROUVABLE, 404 SERVICE_INTROUVABLE (masqué, inconnu, autre vitrine, format invalide : sans requête) |

**Règles métier, portées par le service et non par la route**
- **R1 Durée** : `type ∈ {rdv, accompagnement, atelier}` ⇒ `dureeMin` obligatoire.
- **R2 Séances** : `accompagnement` ⇒ `nbSeances` obligatoire (rythme facultatif).
- **R3 Devis** : `type='devis'` ⇒ `tarif='devis'`.
- **R4 Prix** : `tarif='payant'` ⇒ `prixMontant` et `prixDevise` obligatoires.
- **R5 Normalisation** (avant validation) :
  - `type≠accompagnement` ⇒ `nbSeances` et `rythme` à null ;
  - `tarif≠payant` ⇒ prix, devise, `paiementMode` et `paiementInstructions` à null ;
  - `payant` sans `paiementMode` ⇒ `'sur_place'` ;
  - `actif=false` sans `enVedette` explicite ⇒ `enVedette=false`.
- **R6** : `enVedette=true` ET `actif=false` explicites ⇒ 400 `champs.enVedette` « Un service masqué ne peut pas être en vedette. »
- **R7 Plafond** : au plus `VEDETTE_MAX` services en vedette par vitrine.
  - Création sans `enVedette` ⇒ automatique (vrai si moins de 3 et actif).
  - Demande explicite au-delà ⇒ 409 avec la liste des vedettes actuelles (ordre).
  - Un service déjà en vedette ne se compte pas lui-même.
- **R8 Paiement** : drapeau faux et `paiementMode ∈ {en_ligne, au_choix}` ⇒ 422.
- **R9 Image** : `imageMediaId` doit appartenir au même utilisateur, sinon 422 MEDIA_INVALIDE. Une image remplacée ou retirée est supprimée après le commit si plus rien ne la référence (`deleteMediaIfUnreferenced`).
- **R10 Slug et ordre** : slug généré à la création (R27) ; `ordre = max + 1`.
- **R11 Accueil** : `aLaUne` = visibles en vedette (ordre) ; si aucun, les 3 premiers visibles.
- **R12 Autres** : `autres` = 2 autres visibles au maximum, par ordre, hors service courant.
- **R13 Paramètres publics** : `username` et `slug` passés par `trim().toLowerCase()` ; format invalide ⇒ 404 sans requête.

**SEO du détail (dans le DTO)**
- `seo.titre = "${titre} — ${nomAffiche}"`.
- `seo.description` = description tronquée à 160 caractères sur une limite de mot, sinon `"${titre} avec ${nomAffiche}, ${metier} à ${ville}."`.

## 6. Découpage serveur

- **`server/services/services-regles.ts`** (pur, comme `vitrines-regles.ts`) :
  - `slugFromTitle(titre)` : slugify configuré, tronqué à 80 sans tiret final, repli `'service'` ;
  - `pickAvailableSlug(base, existants: Set<string>)` : `base`, `base-2`… dans la limite de 80 ;
  - `normalizeServiceState(etat, patch)` ;
  - `checkServiceCoherence(etat): Record<string,string[]>` (R1 à R4, R6) ;
  - `resolveEnVedette({ demande, actif, autresEnVedette, max }): boolean | 'COMPLET'` ;
  - `computeALaUne(visibles, max)` ;
  - `computeCompteurs(lignes, max)`.
- **`server/services/services.ts`** (aucun `event`) :
  - `listOwnServices(userId)`
  - `getOwnService(userId, id)`
  - `createService(userId, input, opts = { paiementEnLigne: env.PAIEMENT_EN_LIGNE })` :
    - transaction ;
    - `SELECT … FROM vitrines WHERE user_id = $1 FOR UPDATE` (verrou qui sérialise vedette, slug et ordre) ;
    - normalisation, cohérence (sinon `ValidationError(champs)`), R8, R9, R7 ;
    - slugs existants de la vitrine, puis `pickAvailableSlug` ;
    - insertion ;
    - 23505 sur `services_vitrine_id_slug_unique` : une nouvelle tentative, puis erreur ;
    - 23503 sur `services_image_media_id_medias_id_fk` ⇒ MEDIA_INVALIDE.
  - `updateService(userId, id, patch, opts)` : même verrou ; `SELECT service FOR UPDATE` filtré par vitrine (sinon SERVICE_INTROUVABLE) ; fusion → normalisation → cohérence → R7/R8/R9 → UPDATE ; après le commit, `deleteMediaIfUnreferenced` sur l'ancienne image (échec journalisé sans PII).
  - `deleteService(userId, id)` : DELETE … RETURNING `image_media_id` ; aucune ligne ⇒ 404 ; après le commit, nettoyage de l'image.
  - `reorderServices(userId, ids)` : verrou vitrine ; ensemble égal sinon ORDRE_INVALIDE ; un seul `UPDATE … FROM unnest($ids) WITH ORDINALITY` (ordre = rang − 1).
  - `getPublicServices(rawUsername)` : réutilise `getPublicVitrine` ; une requête services + `LEFT JOIN medias`, `actif = true`, tri ordre/création/id.
  - `getPublicService(rawUsername, rawSlug)`.
  - Toutes renvoient des lignes et images, jamais de DTO.
- **`server/resources/service.ts`** :
  - `toServiceStudioResource`, `toServicesCompteursResource`, `toServicePublicCarteResource` ;
  - `toServicePublicDetailResource(row, image, vitrine, { paiementEnLigne })` : force `sur_place` si le drapeau est faux ; liste blanche explicite, jamais de spread ;
  - les colonnes texte sont rétrécies (`asServiceType`…) comme `asPalette`.
- **Routes** : `defineApiHandler` + `requireUserSession` + `readBodyWith`/`readParamsWith` (`z.object({ id: z.uuid() })`) + service + ressource. `setResponseStatus(event, 201)` sur POST ; `sendNoContent` sur DELETE. Côté public, les paramètres sont lus en `z.string()` : le service normalise.
- `server/services/medias.ts` et `server/services/vitrines.ts` : **inchangés** (`deleteMediaIfUnreferenced` couvre déjà `services.image_media_id`, `summarize` compte déjà les services actifs).

## 7. Critères d'acceptation (Given/When/Then)

Identifiants préfixés `S3-CA` pour ne pas se confondre avec les CA de S2. Sauf mention contraire, « A » est un utilisateur avec une vitrine publiée `dr-test`, « B » un autre utilisateur, et les appels passent par les vrais services, la vraie base et le vrai disque.

### Base
- **S3-CA01 Migration**
  - **Given** une base en 0009 contenant : un service payant sans prix, un devis au tarif payant, deux slugs `consultation` dans la même vitrine, un slug `Mon Slug!`, une image appartenant à B sur un service de A, 4 services en vedette, un service en vedette masqué, `rythme='Hebdomadaire'`.
  - **When** 0010 est appliquée.
  - **Then** :
    - payant sans prix → `tarif='devis'` et prix NULL ;
    - devis → tarif `devis` ;
    - doublon renommé `consultation-<8 hex>` ;
    - slug invalide → `service-<8 hex>` ;
    - image → NULL ;
    - seules les 3 premières vedettes (ordre) restent ;
    - vedette masquée → false ;
    - rythme `hebdomadaire` ;
    - toutes les contraintes valident ; up → down → up passe.
- **S3-CA02 CHECK** : **When** un INSERT direct contient l'un de ces cas : type `consultation` ; tarif payant sans prix ; devis au tarif payant ; rdv sans durée ; accompagnement sans `nb_seances` ; rdv avec `nb_seances=6` ; `en_vedette` vrai et `actif` faux ; slug `Bad Slug` ; devise `GBP` ; prix 0 ; 13 lignes `inclus` ; durée 3. **Then** chacun est rejeté (SQLSTATE 23514).
- **S3-CA03 Unicité par vitrine** : même slug dans 2 vitrines → OK ; même slug dans la même vitrine → 23505 `services_vitrine_id_slug_unique`.
- **S3-CA04 FK image** : **Given** un service avec image M. **When** la ligne `medias` M est supprimée. **Then** `image_media_id` vaut NULL.

### Création
- **S3-CA05**
  - **Given** A sans service.
  - **When** `createService(A, {titre:'Consultation de cardiologie', type:'rdv', dureeMin:45, tarif:'payant', prixMontant:15000, prixDevise:'XAF'})`.
  - **Then** :
    - slug `consultation-de-cardiologie`, ordre 0 ;
    - actif, réservable, `enVedette` true ;
    - `paiementMode` `sur_place`, inclus `[]` ;
    - compteurs `{total:1, visibles:1, enVedette:1, vedetteMax:3}`.
- **S3-CA06 Vedette automatique** : 4 créations sans `enVedette` → vedettes `[true,true,true,false]`, ordres 0 à 3.
- **S3-CA07** : 1re création avec `enVedette:false` → false. Les 3 suivantes sans le champ → true, true, true ; la 5e → false.
- **S3-CA08 Plafond à la création** : **Given** 3 vedettes. **When** une création avec `enVedette:true`. **Then** `VEDETTE_COMPLETE` (409) avec `data.enVedette` = les 3 `{id,titre}` dans l'ordre ; aucune ligne insérée.
- **S3-CA09 Slugs**
  - `'Échographie cœur & poumons'` → `echographie-coeur-et-poumons`
  - même titre une 2e fois → `-2`, une 3e fois → `-3`
  - `'!!!'` → `service`
  - titre de 80 caractères accentués → slug ≤ 80 sans tiret final
  - même titre dans la vitrine de B → sans suffixe
- **S3-CA10 Slug stable** : un PUT `{titre:'Nouveau titre'}` laisse le slug inchangé.
- **S3-CA11 Validation** (400 VALIDATION, champ visé) :
  - rdv sans durée → `dureeMin` ; atelier sans durée → `dureeMin`
  - accompagnement sans séances → `nbSeances`
  - devis au tarif payant → `tarif`
  - payant sans prix → `prixMontant` ; payant sans devise → `prixDevise`
  - `prixMontant` 12.5 ou 0 → `prixMontant`
  - `nbSeances` 1 → `nbSeances`
  - titre vide → `titre`
  - 13 lignes `inclus` → `inclus`
  - clés `slug`, `ordre`, `vitrineId` → 400 (strict)
  - Cas valide : devis sans durée → 201.
- **S3-CA12 Normalisation** :
  - rdv avec `nbSeances:6` et `rythme` → stockés NULL ;
  - gratuit avec prix → prix NULL ;
  - payant sans `paiementMode` → `sur_place` ;
  - `inclus ['  a ','','b']` → `['a','b']`.
- **S3-CA13 Drapeau** : avec `paiementEnLigne:false`, `paiementMode:'au_choix'` → 422 PAIEMENT_EN_LIGNE_INDISPONIBLE, rien persisté. Avec `paiementEnLigne:true` → accepté.
- **S3-CA14 Image** : `imageMediaId` de B ou inexistant → 422 MEDIA_INVALIDE, rien persisté. Image de A → `service.image.url = /medias/<id>/1600.webp`.
- **S3-CA15** : utilisateur sans vitrine → 404 VITRINE_INTROUVABLE.

### Mise à jour
- **S3-CA16** : PUT `{description:'x'}` ne change que `description` et `modifieLe`.
- **S3-CA17 Changement de type** : rdv → accompagnement sans `nbSeances` → 400 `nbSeances` (base inchangée) ; avec `nbSeances:6` → 200. Accompagnement → rdv → `nbSeances` et `rythme` NULL.
- **S3-CA18** : payant → gratuit → prix, devise, `paiementMode` et instructions NULL.
- **S3-CA19 Plafond à la mise à jour**
  - **Given** S1, S2, S3 en vedette et S4 non.
  - **When** PUT S4 `{enVedette:true}`. **Then** 409, `data.enVedette` titres S1 à S3.
  - **When** PUT S2 `{enVedette:false}` puis S4 `{enVedette:true}`. **Then** 200, compteurs `enVedette` 3.
- **S3-CA20** : PUT S1 (déjà en vedette, 3 vedettes) `{enVedette:true}` → 200.
- **S3-CA21 Masquer**
  - PUT S1 `{actif:false}` → actif false, `enVedette` false, compteurs `visibles` −1 et `enVedette` −1.
  - `{actif:false, enVedette:true}` → 400 `enVedette`.
  - PUT d'un service masqué `{enVedette:true}` → 400 `enVedette`.
- **S3-CA22 Concurrence**
  - **Given** 2 vedettes. **When** `Promise.all` de PUT `{enVedette:true}` sur S3 et S4. **Then** exactement un 200 et un VEDETTE_COMPLETE ; 3 vedettes en base ; aucune erreur non métier.
  - **Given** rien. **When** 2 créations simultanées « Bilan ». **Then** slugs `bilan` et `bilan-2`.
- **S3-CA23 Image remplacée**
  - Remplacement → l'ancienne ligne et ses 3 fichiers sont supprimés.
  - Si l'ancienne image est aussi la photo de la vitrine → conservée.
  - `imageMediaId:null` → image retirée puis supprimée.
- **S3-CA24 Isolation** : GET, PUT et DELETE par B d'un service de A → 404 SERVICE_INTROUVABLE ; service de A intact.
- **S3-CA25** : PUT `{}` → 400.

### Suppression et ordre
- **S3-CA26 Suppression**
  - DELETE → service absent, image supprimée si non référencée.
  - Une vedette supprimée libère sa place : la création suivante est automatiquement en vedette.
- **S3-CA27** : DELETE d'un uuid inconnu → 404 SERVICE_INTROUVABLE.
- **S3-CA28 Réordonnancement** : `reorder([S3,S1,S2])` → ordres 2→0, 0→1, 1→2. La liste studio et la liste publique suivent cet ordre.
- **S3-CA29 Ordre invalide** : l'un des cas suivants → 422 ORDRE_INVALIDE et ordres inchangés :
  - liste incomplète ;
  - doublon ;
  - id de B ;
  - id inconnu en plus.
- **S3-CA30 Liste studio** : **Given** 6 services (5 visibles, 3 en vedette). **Then** `listOwnServices` renvoie les 6 dans l'ordre et compteurs `{total:6, visibles:5, enVedette:3, vedetteMax:3}`.

### Public
- **S3-CA31** : `getPublicServices('dr-test')` → `services` = visibles dans l'ordre ; `total` = 5 ; `aLaUne` = les vedettes dans l'ordre ; le masqué est absent partout.
- **S3-CA32 Repli** : aucun service en vedette, 5 visibles → `aLaUne` = les 3 premiers par ordre.
- **S3-CA33** : vitrine publiée sans service visible → `{total:0, services:[], aLaUne:[]}`.
- **S3-CA34** : vitrine non publiée, inconnue, ou username `Bad_Name` → 404 VITRINE_INTROUVABLE.
- **S3-CA35 Détail**
  - Slug visible → `service` + `autres` (≤ 2, sans le courant, dans l'ordre) + `total`.
  - Masqué, slug d'une autre vitrine ou `bad_slug!` (sans requête) → 404 SERVICE_INTROUVABLE.
  - `CONSULTATION-DE-CARDIOLOGIE` → trouvé.
- **S3-CA36 Liste blanche**
  - Les clés du DTO public sont **exactement** celles de `ServicePublicCarteDTO` / `ServicePublicDetailDTO`.
  - Base `au_choix` + drapeau faux → `paiementMode:'sur_place'`.
  - `seo.titre` = `'Consultation de cardiologie — Dr Cabrel Nguesso'`.
  - Description de 300 caractères → `seo.description` ≤ 160 ; sans description → repli `"… avec Dr Cabrel Nguesso, Cardiologue à Douala."`.
- **S3-CA37** : après `{actif:false}`, le service disparaît de `services` et de `aLaUne`, et son détail répond 404 (critère SPRINTS).

### Transversal, HTTP et UI
- **S3-CA38** : sans session, toutes ces routes → 401 : GET/POST `/api/studio/services`, GET/PUT/DELETE `/api/studio/services/<uuid>`, POST `/reordonner`. L'authentification passe avant la validation.
- **S3-CA39 Les routes existent** (c'était le bug) : connecté, GET `/api/studio/services/<uuid aléatoire>` → 404 `data.code` SERVICE_INTROUVABLE ; `/api/studio/services/pas-un-uuid` → 400 VALIDATION.
- **S3-CA40** : POST → 201. Les clés de `service` sont exactement `ServiceStudioDTO` (pas de `vitrineId`, `createdAt`, `imageMediaId`). Le message d'erreur accentué reste intact.
- **S3-CA41 Parcours API** : 4 créations → `/api/public/<u>/services` `aLaUne` 3 → masquer S1 → détail S1 404 → réordonner → l'ordre public suit.
- **S3-CA42** : `GET /api/public/services` → 404 `data.code` VITRINE_INTROUVABLE (ancienne route supprimée, `services` est un mot réservé).
- **S3-CA43** : U8, plus aucun fichier `services.[` ; plafond d'exceptions 9.
- **S3-CA44 Pages publiques montées** : `GET /dr-cabrel/services` affiche la grille « Mes services » (pas l'accueil) ; `/dr-cabrel/services/consultation-de-cardiologie` affiche le détail. Régression du routage imbriqué.
- **S3-CA45 Studio, formulaire conditionnel**
  - « Accompagnement » → le bloc Séances, Durée et Rythme apparaît.
  - « Prestation sur devis » → tarif verrouillé « Sur devis », prix masqué.
  - Rendez-vous payant enregistré → la liste affiche « Rendez-vous · 45 min · Payant » et l'étiquette « En vedette ».
  - Interrupteur de visibilité coupé → ligne grisée « … · Masqué ».
- **S3-CA46** : 3 vedettes, édition d'un 4e service → interrupteur « En vedette sur l'accueil » désactivé, avec le texte « 3 services sur 3 en vedette. Retirez-en un pour en ajouter un autre. »
- **S3-CA47 Accueil public**
  - À 390 px : section « Ce que je propose », défilement horizontal (`scrollWidth > clientWidth`), région focusable, `ArrowRight` fait défiler.
  - À 1280 px : 3 cartes côte à côte, lien « Voir tous les services (n) ».
  - Libellé d'action selon le type ; carte sans photo = aplat d'accent + initiale.
- **S3-CA48** : vitrine sans service → pas de section sur l'accueil, pas de lien « Services » dans la barre, `/u/services` → page 404.
- **S3-CA49** : le HTML de `GET /studio/services/nouveau` ne contient aucun contenu rendu serveur (`ssr:false`).

## 8. Tests

### Unitaires (`tests/unit/`)
- U12 `schemas-service.test.ts` : création (défauts, strict, `inclus`, `blankToNull`), mise à jour (vide, strict), réordonnancement (doublons) ; S3-CA11 côté schéma.
- U13 `services-regles.test.ts` : `normalizeServiceState`, `checkServiceCoherence` (R1 à R6), `resolveEnVedette`, `computeALaUne`, `computeCompteurs`.
- U14 `slug-service.test.ts` : `slugFromTitle`, `pickAvailableSlug` (S3-CA09).
- U15 `devises.test.ts` : `formatPrix` (normaliser les espaces insécables), `parsePrixSaisi`, `toMajorUnits`, `formatPrixSaisi`.
- U16 `services-libelles.test.ts` : exhaustivité des tables pour chaque `SERVICE_TYPES`/`TARIFS`/`RYTHMES`, `metaStudio`, `libellePrix`, `resumeSeances*`, `initialeDuTitre('Échographie')='É'`, `serviceActionHref`.
- U17 `resource-service.test.ts` : liste blanche, paiement forcé, SEO (S3-CA36).
- U8 mis à jour (S3-CA43) ; `env.test.ts` et `env-drapeaux.test.ts` : `PAIEMENT_EN_LIGNE` (défaut false, `'true'` → true, valeur invalide → erreur).

### Intégration (`tests/integration/services.test.ts`)
- Vrais PostgreSQL, Redis et disque ; **aucun mock de db, de stockage ni du service**. On ne mocke rien : le drapeau est passé en option.
- Couvre S3-CA02 à CA37.
- `migration-0010.test.ts` (S3-CA01) : base dédiée ou schéma temporaire ; migrer jusqu'à 0009, insérer les données, appliquer 0010, vérifier ; puis ROLLBACK et ré-application.
- Fabrique `insertService` : renvoie la ligne ; défauts compatibles avec les CHECK (rdv, 30 min, gratuit, slug `service-xxxxxxxx`) ; ajouter `insertServiceComplet` si utile.
- Les tests S2 qui utilisent `insertService` (vitrines CA7/CA17, médias) doivent rester verts.

### e2e API (`e2e/api/services.spec.ts`, une session par fichier, `describe.serial`)
- S3-CA39, CA40, CA41, CA42.
- `studio-auth.spec.ts` : ajouter les routes de S3-CA38.

### e2e UI (`e2e/services.spec.ts`, rédigé par l'e2e-tester après F)
- S3-CA44 à CA49, à 390, 768 et 1280 px.
- Seed `dr-cabrel` pour les pages publiques ; vitrine fraîche pour l'état vide.

Gate : 0 test sauté ; toutes les suites tournent en CI (job `verification` existant).

## 9. Plan frontend (injection d'exemples : lire d'abord `studio/profil.vue`, `useProfilForm.ts`, `PhotoUpload.vue`, `vitrine/Hero.vue`)

Règles communes :
- `@nuxt/ui` partout (UButton, UInput, UTextarea, USelect, URadioGroup, USwitch, UFormField, UBadge, UModal, USkeleton, UEmpty, UBreadcrumb, UIcon `i-ph-*`).
- Classes Tailwind sur variables de palette, aucune couleur en dur.
- Typage par les DTO de `#shared/dto`, erreurs lues par `lireErreurApi`.
- Aucune logique métier : règles et libellés viennent de `#shared/services` et `#shared/devises`.

### F-studio

**`/studio/services` (`pages/studio/services/index.vue`) — maquette `Studio · Services`**
- **En-tête** : h1 « Services » ; sous-titre `{visibles} visibles · {enVedette} en vedette sur {vedetteMax}` ; UButton « Ajouter » vers `/studio/services/nouveau`.
- **Composant `StudioServiceLigne.vue`** (props `{ service: ServiceStudioDTO; occupe: boolean }`) :
  - miniature 56 px (image 400 ou case vide en pointillés) ;
  - titre ; `metaStudio` ; UBadge « En vedette » (soft, `accent-doux`/`accent`) ;
  - USwitch à droite, `aria-label="Visible sur la vitrine : {titre}"` ;
  - ligne entière en NuxtLink vers `/studio/services/{id}`, interrupteur hors du lien ;
  - service masqué : `opacity` réduite + « Masqué » ;
  - poignée `i-ph-dots-six-vertical` (UButton ghost, `aria-label="Déplacer {titre}"`, flèches haut/bas).
- **Texte d'aide en bas** : « L'interrupteur masque un service sur votre vitrine sans le supprimer. Les services en vedette s'affichent en premier sur l'accueil. »
- **États** : chargement (USkeleton ×4) ; sans vitrine (UEmpty vers `/onboarding`) ; erreur (UEmpty « Réessayer ») ; vide (`StudioVide` : icône `i-ph-briefcase`, « Présentez ce que vous proposez », « Ajoutez votre premier service : vos visiteurs sauront comment travailler avec vous. », bouton « Ajouter un service »).
- Un seul message d'erreur à la fois, sous l'en-tête, `role="alert"`.

**`useStudioServices.ts`**
- `useFetch` avec la clé `studio-services` (`server:false`, `lazy`).
- `basculerVisibilite(id, actif)` : PUT `{actif}`, optimiste, retour arrière et message en cas d'échec.
- `reordonner(ids)` : POST `reordonner` ; sur ORDRE_INVALIDE, rafraîchir et afficher le message.
- Glisser via `useSortable` (`@vueuse/integrations`) sur la poignée.

**`/studio/services/nouveau` et `/studio/services/[id]` — maquette `Studio · Modifier un service`**
- `[slug].vue` est supprimé et remplacé par `[id].vue`.
- Les deux pages rendent `StudioServiceForm.vue` (props `{ service: ServiceStudioDTO | null; compteurs: ServicesCompteursDTO; deviseParDefaut: Devise }`).
- **Ordre des champs**
  1. StudioRetour « Services ».
  2. h1 « Nouveau service » ou « Modifier le service ».
  3. **Photo · facultative** (`StudioServicePhoto.vue`) : tuile carrée en pointillés `accent-doux` + lien « Ajouter une photo » / « Changer la photo » + « Retirer la photo » + aide « Elle s'affiche sur la fiche du service. » ; utilise `useMediaUpload`.
  4. Titre (UInput, max 80).
  5. Description (UTextarea).
  6. Type de service (USelect, `SERVICE_TYPE_LIBELLES`, aide « Le type adapte le bouton et le parcours de réservation du visiteur. »).
  7. Selon le type :
     - accompagnement : panneau `bg-surface` titré « ACCOMPAGNEMENT » avec Séances + Durée (min) et Rythme (USelect `RYTHME_LIBELLES`, facultatif) ;
     - rdv et atelier : champ « Durée (min) » ;
     - devis : « Durée (min) · facultative ».
  8. **Tarif** : URadioGroup horizontal variante `table`, indicateur masqué (Gratuit / Payant / Sur devis) ; pour devis, seules les options autres que « Sur devis » sont désactivées, avec une aide.
  9. Si payant : « Prix » (« Prix du forfait » pour un accompagnement), UInput `inputmode` numeric ou decimal selon la devise, conversion par `parsePrixSaisi` ; « Devise » (USelect XAF/EUR/USD, défaut = devise du compte via `useMoi`).
  10. Si payant, « Comment le client règle-t-il ? » :
      - URadioGroup variante `card`, options = `PAIEMENT_MODES_HORS_LIGNE` si `runtimeConfig.public.paiementEnLigne` est faux, sinon les 3 ;
      - puis « Instructions de règlement · facultatif » (UTextarea, exemple « Mobile Money au +237…, ou en espèces au cabinet. »).
  11. « Ce que comprend le service · facultatif » : UTextarea, une ligne par élément, aide « Pour un accompagnement, une ligne par étape du programme. »
  12. Trois USwitch avec `label` et `description` :
      - « Visible sur la vitrine » / « Désactivez pour masquer ce service sans le supprimer. » ;
      - « Réservable en ligne » / « Le visiteur peut réserver ou faire sa demande depuis la vitrine. » ;
      - « En vedette sur l'accueil » / `` `${n} services sur ${max} en vedette.` `` + « Retirez-en un pour en ajouter un autre. » si complet ; désactivé si complet et pas déjà en vedette, ou si le service est masqué.
  13. UButton « Enregistrer » (bloc, `loading`).
  14. En modification : lien « Supprimer ce service », qui ouvre un UModal « Supprimer « {titre} » ? Il disparaîtra de votre vitrine. Cette action est définitive. » (Supprimer en couleur error / Annuler).
- **`useServiceForm.ts`**
  - État depuis le DTO, valeurs envoyées (POST : tout ; PUT : champs modifiés seulement).
  - Erreurs 400 `champs` rangées par champ.
  - VEDETTE_COMPLETE : message sous l'interrupteur avec les titres de `data.enVedette`.
  - MEDIA_INVALIDE sous la photo ; SERVICE_INTROUVABLE → UEmpty « Ce service n'existe plus » avec retour.
  - Succès : `refreshNuxtData('studio-services')`, `refreshNuxtData('studio-vitrine')`, puis `navigateTo('/studio/services')`.
- **`useStudioNav.ts`** : les chemins sous `/studio/services/` (nouveau et `[id]`) deviennent des écrans enfants (barre du bas masquée) ; entrée Services active.

### F-public

**Routage**
- Déplacer `pages/[username].vue` vers `pages/[username]/index.vue` (contenu repris, plus la section services).
- Nouveau `components/vitrine/Cadre.vue` (props `{ vitrine: VitrinePubliqueDTO; servicesTotal: number }`) : `useHead` `data-palette` + `lang` ; `VitrineNav` ; `<slot>` ; `VitrinePied`.
- **`VitrineNav`** (modifié) : props `{ nomAffiche; username; servicesTotal }` ; le nom renvoie à `/{username}` ; lien « Services » visible à partir de `md` si `servicesTotal > 0`.

**Composables**
- `usePublicServices(username)` : `useAsyncData('services-publics-'+u)`.
- `usePublicService(username, slug)` : 404 → `createError` fatal, comme `usePublicVitrine`.

**`ServiceVisuel.vue`** (props `{ image: MediaDTO|null; titre: string; hauteur: 'carte'|'detail' }`)
- `img` avec `srcset`/`sizes`, `object-cover` ;
- sinon aplat `bg-accent`, grande initiale serif en `text-fond`, cercle décoratif `bg-fond/20` (aucune couleur en dur).

**`ServiceCarte.vue`** — un seul composant pour l'accueil et la page Services (props `{ service: ServicePublicCarteDTO; username: string }`)
- Visuel de 200 à 220 px avec pastille du type (blanche, en haut à gauche, `SERVICE_TYPE_PASTILLES`).
- h3 serif, lien vers le détail.
- Description `line-clamp-2`.
- Méta `i-ph-clock` : `formatDureeCourte` ou `resumeSeancesCourt` ; masquée si devis sans durée.
- Séparateur ; `libellePrix` à gauche ; UButton `SERVICE_ACTIONS[type].court` vers `serviceActionHref` (ou « Voir le détail » si non réservable).

**Accueil `/[username]` — maquettes `Vitrine · Terracotta` / `Tablette` / `PC`**
- `VitrineServicesALaUne.vue` placé entre le Hero et le pied ; rendu seulement si `total > 0`.
- Surtitre « SERVICES · À LA UNE », h2 « Ce que je propose ».
- Lien « Voir tous les services ({total}) » (en haut à droite à partir de `md`).
- **Mobile et tablette** : `ul` en `overflow-x-auto snap-x snap-mandatory`, cartes à ~85 % (mobile) / ~45 % (tablette) avec la suivante qui dépasse ; `role="region"`, `aria-label="Services à la une"`, `tabindex="0"`.
- **≥ 1024 px** : grille de 3 colonnes.
- **Mobile** : UButton outline « Voir tous les services ({total}) » sous la liste.

**`/[username]/services` — maquette `Page Services · PC`**
- UBreadcrumb « Accueil / Services » ; h1 « Mes services » ; intro « Choisissez la prestation qui correspond à votre besoin, puis réservez le créneau qui vous convient. »
- Grille 1, 2 puis 3 colonnes de `ServiceCarte`.
- `total === 0` → `createError` 404 (règle §4.2 « une page n'est visible que si elle a du contenu »).
- SEO : titre `Services — {nomAffiche}`.

**`/[username]/services/[slug]` — maquettes `Service · Mobile` et `Service · PC`**
- **Mobile**
  - « ← Tous les services » ; `ServiceVisuel` plein largeur ; pastille ; h1.
  - Faits avec icônes : `i-ph-clock` (durée ou résumé des séances), `i-ph-wallet` (`libellePrix · sur place`), `i-ph-map-pin` (`{ville}, {paysLibelle}`).
  - Description (`whitespace-pre-line`, jamais de `v-html`).
  - `inclus` : « Ce que comprend ce service » (`i-ph-check`) ou « Le programme » (numéros serif 01…).
  - Carte prix (`bg-accent-doux`) : prix + `paiementInstructions` ou « Vous réglez sur place, au moment de la séance. »
  - « Autres services » (lignes titre serif + méta + `i-ph-caret-right`) + « Voir tous les services ({total}) ».
  - Barre fixe en bas (`md:hidden`) : durée et prix à gauche, bouton d'action à droite.
- **PC**
  - 2 colonnes. Gauche : visuel, pastille, h1, description, programme.
  - Droite, carte collante `bg-surface` :
    - surtitre « FORFAIT » ou « TARIF » ; prix en grand (serif) ; résumé des séances ;
    - faits : paiement, ville ;
    - UButton `SERVICE_ACTIONS[type].long` ;
    - UButton outline « Poser une question sur WhatsApp » (si WhatsApp ; `wa.me` avec un texte prérempli encodé) ;
    - note accompagnement « Les séances suivantes sont planifiées ensemble après la première. »
- **Exclus jusqu'à S7** : « Prochains créneaux », « Première séance ».
- **SEO** : `useSeoMeta` depuis `service.seo` ; données structurées `Service` (provider Person, `areaServed` ville, `offers` seulement si payant, `price: toMajorUnits`) via `useSchemaOrg` de `@nuxtjs/seo`. Vérifier dans la documentation la prise en charge d'un nœud `Service` brut et le signaler s'il manque.

**`/[username]/reserver`** (provisoire)
- `noindex`, h1 « Réserver avec {nomAffiche} ».
- « La réservation en ligne arrive très bientôt. En attendant, contactez-moi directement. »
- Boutons WhatsApp, téléphone, email selon le contact.

### Écarts maquette assumés
- Poignée de glisser dans la liste studio.
- Champs Durée hors du panneau pour rdv et atelier.
- Instructions de règlement et « Ce que comprend » dans le formulaire.
- Un seul mode de règlement proposé (drapeau).
- Pas de « Prochains créneaux ».
- Bouton du haut « Me contacter » au lieu de « Réserver ».
- « Autres services » aussi sur PC (la maquette ne dit rien).

## 10. Plan de tâches (périmètres de fichiers disjoints)

| # | Agent | Tâche | Fichiers exclusifs | Dépend de | Taille |
|---|---|---|---|---|---|
| L1a | backend | contrats §4, drapeau, dépendances | `shared/services.ts`, `shared/devises.ts`, `shared/schemas/service.ts`, `shared/dto/service.ts`, `shared/dto/index.ts`, `shared/erreurs.ts`, `shared/env.ts`, `server/exceptions/http.ts`, `nuxt.config.ts`, `.env.example`, `package.json`, `pnpm-lock.yaml` | — | M |
| L1b | database | schema.ts, migration 0010 + snapshot + journal, seed ; test up → down → up | `shared/db/schema.ts`, `server/db/migrations/**`, `server/db/seed.ts` | — (parallèle à L1a) | M |
| L2 | tester (RED) | §8 unitaires, intégration, e2e API, U8, studio-auth, env, fabriques | `tests/**`, `e2e/api/**` | L1a, L1b | L |
| L3 | backend (GREEN, 3 cycles max) | §6 : `services-regles.ts`, `services.ts`, `resources/service.ts`, 8 routes ; suppression des 7 anciens fichiers de route | `server/**` sauf `server/db/**` et `server/exceptions/http.ts` | L2 | L |
| F1 | frontend | F-studio §9 ; supprimer `pages/studio/services/[slug].vue` | `app/pages/studio/services/**`, `app/components/StudioService*.vue`, `app/composables/useStudioServices.ts`, `app/composables/useServiceForm.ts`, `app/composables/useStudioNav.ts` | L1a | L |
| F2 | frontend | F-public §9 ; déplacer `pages/[username].vue` | `app/pages/[username].vue` (suppression), `app/pages/[username]/index.vue`, `app/pages/[username]/services/**`, `app/pages/[username]/reserver.vue`, `app/components/service/**`, `app/components/vitrine/{Cadre,Nav,ServicesALaUne}.vue`, `app/composables/usePublicServices.ts`, `app/composables/usePublicService.ts` | L1a | L |
| L4 | e2e-tester | e2e UI S3-CA44 à 49 | `e2e/services.spec.ts` | L3, F1, F2 | M |
| L5 | reviewer + regression-checker + ux-reviewer | lecture seule. Consommateurs à vérifier : `studio/index.vue` (compteurs), `vitrines.ts` `summarize`, `medias.ts` `deleteMediaIfUnreferenced`, tests S2 qui utilisent `insertService`, `@[username].vue`, pages S4/S5 désormais montées sous `[username]/` | — | L4 | M |
| L6 | thread principal | `PROJECT_STATE.md`, `CLAUDE.md` §8 (`@sindresorhus/slugify` : slugs accentués et translittération ; `@vueuse/integrations` + `sortablejs` : glisser-déposer accessible), `docs/JOURNAL_DECISIONS.md` (#23 à #45, écarts maquette) | ces 3 fichiers | L5 | S |

**Parallélisme possible** : L1a ∥ L1b, puis L2 ∥ F1 ∥ F2, puis L3.

**Fin de lot** : `pnpm lint`, `pnpm typecheck`, `pnpm test` (0 test sauté), `pnpm e2e`, `pnpm build` verts, sortie brute collée. Nombre de fichiers prévus = nombre traités : environ 48 (dont 9 suppressions ou déplacements).

## 11. Points d'attention

**Sécurité**
- Isolation : toute requête studio est filtrée par la vitrine de `session.user.id` ; un id d'autrui donne 404, jamais 403 (pas de fuite d'existence).
- Propriété de l'image vérifiée.
- DTO publics en liste blanche ; description rendue en texte (pas de `v-html`) ; lien WhatsApp encodé.
- `rel="noopener"` sur les liens externes.
- CSRF identique à S2.

**Concurrence**
- Verrou `FOR UPDATE` sur la ligne vitrine pour la création, la mise à jour vedette ou ordre, et le réordonnancement.
- Unicité du slug garantie par l'index (23505 → nouvelle tentative) ; CHECK en défense en profondeur.

**Performance**
- Une requête par liste (JOIN `medias`), pas de N+1.
- Pas de bibliothèque de carrousel sur les pages publiques.
- Images en `srcset` ; `sizes` adapté à la carte (`(min-width:1024px) 33vw, 85vw`).
- Pas de cache HTTP public en S3 (S12).

**Dépendances futures**
- S7 : FK `reservations.service_id` et `demandes.service_id` à créer en `ON DELETE RESTRICT` ou `SET NULL`. La suppression d'un service avec des réservations devra être tranchée en S7 (proposition : bloquer, inviter à masquer).
- S10 : `PlanService` branché dans `createService` (refus au-delà de la limite) et dans `getPublicServices` (masquer les plus récents au-delà de la limite) : ce sont les deux seuls points d'insertion.
- S12 : sitemap des services, cache par page.

**Données de développement** : les normalisations de 0010 sont irréversibles (bloc ROLLBACK seulement structurel). C'est accepté (dette S0 « réversibilité par migration forward »).

**Pages S4/S5** : une fois `[username].vue` déplacé, `/u/realisations` et `/u/temoignages` deviennent atteignables et appellent des API absentes (page d'erreur au lieu de l'accueil). C'est acceptable jusqu'à leur sprint ; à noter dans le rapport et non à corriger en S3.

**Hors périmètre** : créneaux, réservations, demandes, paiement en ligne, limites du plan gratuit, IA, sitemap, cache, édition du slug, duplication de service, catégories.

## Décisions produit ambiguës à faire trancher par Cabrel (défaut proposé)
1. **Prix du seed** (#37) : valeurs de travail conservées et signalées. Cabrel fournit les vrais montants ou accepte un affichage provisoire.
2. **Repli de l'accueil sans vedette** (#26) : les 3 premiers visibles. Alternative : section masquée.
3. **Masquer retire la vedette** (#25). Alternative : la place en vedette reste occupée par un service masqué.
4. **Affichage XAF en code** (« 15 000 XAF », comme les maquettes) plutôt que « FCFA » (#29).
5. **Type devis ⇒ tarif devis** (#31). Alternative : autoriser un prix indicatif.
6. **Liste fermée des rythmes** (#32).
7. **Réordonnancement avec poignée visible** (#40), absente de la maquette.
8. **Cible du bouton d'action en S3** : page provisoire `/[username]/reserver` (#35).
9. **Bouton du haut « Réserver » des maquettes** reporté à S7 (#45).
10. **Titres de la liste « inclus »** : « Ce que comprend ce service » / « Le programme » (#42) ; la maquette dit « Ce que comprend la consultation », un texte propre au métier.

## Fichiers clés (absolus)
- /home/cabrel/projects/brandself-app/brandself-app/app/pages/[username].vue (à déplacer, bug de routage imbriqué)
- /home/cabrel/projects/brandself-app/brandself-app/shared/db/schema.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/db/migrations/0003_services.sql
- /home/cabrel/projects/brandself-app/brandself-app/server/db/migrations/meta/_journal.json
- /home/cabrel/projects/brandself-app/brandself-app/server/db/seed.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/schemas/service.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/api/studio/services.[slug].put.ts (et les 4 autres anciens fichiers `services.*`)
- /home/cabrel/projects/brandself-app/brandself-app/server/api/public/services.get.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/api/public/services/[slug].get.ts
- /home/cabrel/projects/brandself-app/brandself-app/tests/unit/routes-convention.test.ts
- /home/cabrel/projects/brandself-app/brandself-app/e2e/api/studio-auth.spec.ts
- /home/cabrel/projects/brandself-app/brandself-app/app/composables/useStudioNav.ts
- /home/cabrel/projects/brandself-app/brandself-app/app/components/vitrine/Nav.vue