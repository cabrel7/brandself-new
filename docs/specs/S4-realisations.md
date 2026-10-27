# Spec S4 : Réalisations (base, API, studio, pages publiques)

Spec rédigée par l'architect le 2026-10-27, en lecture seule : aucun fichier n'a été modifié. Tier standard. Le domaine ne touche ni l'auth, ni le paiement, ni de nouvelles données personnelles : pas d'escalade de tier.

À écrire dans `docs/specs/S4-realisations.md`.

**Sources lues**
- CLAUDE.md, PROJECT_CONTEXT.md (§3, §4, §4.2, §5, §6, §8.1, §9, §10, §11, §15), PROJECT_STATE.md, SPRINTS.md (bloc commun, S3, S4, S5), `docs/specs/S3-services.md` (en entier).
- `shared/db/schema.ts`, migrations 0004 et 0010, `_journal.json`.
- `shared/{services,erreurs,limites,medias,vitrine}.ts`, `shared/schemas/{service,realisation}.ts`, `shared/dto/{service,vitrine,index}.ts`.
- `server/exceptions/http.ts`, `server/services/{services,services-regles,medias,vitrines}.ts`, `server/resources/{service,media}.ts`, les routes S3 et `public/[username]/index.get.ts`, les 5 routes `realisations*`.
- `server/db/seed.ts`, `tests/unit/routes-convention.test.ts`, `tests/integration/support/fabriques.ts`, `e2e/api/{studio-auth,public}.spec.ts`.
- Côté app : `app/components/vitrine/{Cadre,Nav,ServicesALaUne}.vue`, `service/{ServiceVisuel,ServiceAutres}.vue`, `StudioServicePhoto.vue`, `app/composables/{usePublicVitrine,usePublicServices,usePublicService,useStudioServices,useMediaUpload,useStudioNav}.ts`, `app/pages/[username]/{index,services/*,reserver}.vue`.

**Maquettes lues (PNG)** : `Studio · Réalisations`, `Studio · Nouvelle réalisation`, `Réalisation · Mobile`, `Vitrine · Terracotta` (mobile), `Vitrine · Tablette`, `Vitrine · PC`.
**Maquettes absentes** : il n'y a ni « Page Réalisations », ni « Réalisation · PC ». Ces deux écrans sont dérivés de `Page Services · PC` et `Service · PC` (décision #62). L'ux-reviewer doit les valider.

---

## CHALLENGE

**Hypothèses implicites**
- Le brief dit « S4 existe ». Comme pour S3, presque rien n'est réutilisable :
  - routes inatteignables, aucune couche service ni ressource ;
  - pas de table `realisation_images` ;
  - pas de FK sur l'image, slug global non unique, aucun CHECK ;
  - seed en ids non UUID avec des rôles inventés (« Coordinateur »), ce que §15 interdit ;
  - pages en CSS maison avec `NuxtLink to="/"`.

  C'est une **réécriture**.
- Le brief parle de « galerie éventuelle ». Elle n'est pas éventuelle :
  - PROJECT_CONTEXT §4 et §11 la prévoient (table `realisation_images`) ;
  - SPRINTS S4 la demande (6 images max ⚠️, ajout, suppression, ordre) ;
  - les deux maquettes la montrent (« Galerie · facultative », grille 2×2).

  Elle est donc **incluse**.
- On suppose que le « max 3 en vedette » se voit sur l'accueil. Or **la maquette n'affiche qu'UNE réalisation** dans « À la une », à côté du témoignage. Les 2e et 3e vedettes n'ont aucun effet visible. C'est un vrai trou produit (décision #51, à trancher).

**Angles morts trouvés**
1. **La navigation publique ne peut pas afficher « Réalisations » proprement.**
   - `VitrineCadre` reçoit `servicesTotal`, calculé par chaque page à partir de la liste des services.
   - Ajouter `realisationsTotal` de la même façon obligerait chaque page de services à charger aussi la liste des réalisations, et inversement.
   - Correction : la route `/api/public/:username` (déjà appelée par toutes les pages) renvoie des compteurs `contenus` dans l'**enveloppe**. Le `VitrinePubliqueDTO` reste intact, donc le test S2 CA13 « clés exactes » reste vert.
2. **`deleteMediaIfUnreferenced` ignore la future table `realisation_images`.**
   - Avec `ON DELETE CASCADE` sur `realisation_images.media_id`, remplacer l'image principale d'une réalisation A supprimerait une image encore utilisée dans la galerie de B.
   - Résultat : l'image disparaît silencieusement de la galerie de B. C'est le bug le plus grave possible ici.
3. **Image principale « obligatoire » (SPRINTS) contre maquette.**
   - La liste studio de la maquette montre 2 lignes sans image (tuile en pointillés).
   - Une colonne NOT NULL est incompatible avec `ON DELETE SET NULL` (la route `DELETE /api/studio/medias/:id` existe) et avec les données de développement.
   - Il faut une règle applicative, pas un NOT NULL (décision #47).
4. **Codes d'erreur propres aux services.** Les messages `VEDETTE_COMPLETE` (« … services en vedette ») et `ORDRE_INVALIDE` (« … vos services ») sont faux pour une réalisation. Il faut des messages génériques, sinon 2 codes de plus par sprint pour S5 et S6.
5. **Lien externe = vecteur XSS.** Un `javascript:` dans un `href` public. Il faut une validation Zod http(s) **et** un CHECK en base.
6. **Galerie et concurrence.** Deux PUT de galerie simultanés ne doivent pas mélanger les listes.
   - Le plafond de 6 se garantit en base sans trigger : `CHECK ordre BETWEEN 0 AND 5` et unicité `(realisation_id, ordre)`.
   - Le remplacement se fait sous le verrou vitrine (DELETE puis INSERT dans la même transaction).
7. **Image principale présente aussi dans la galerie** : doublon visuel. La règle doit être évaluée sur l'état fusionné.
8. **Ligne ancienne sans image** (ou image supprimée par la route médias). Si l'obligation est vérifiée sur l'état fusionné, l'interrupteur de visibilité de la liste (PUT `{actif}`) renverrait 400. L'obligation ne doit porter que sur la création et sur un `imageMediaId:null` explicite.
9. **Libellé public « Votre rôle »** (maquette `Réalisation · Mobile`). Il s'adresse au visiteur, c'est une erreur de maquette : on affiche « Rôle ».
10. **Contraste.** Le texte accent en petite taille échoue à 4,5:1 sur la palette Ocre (#9A6A0F sur #FCF8EE ≈ 4,4:1).
    - Tous les surtitres et liens « Voir toutes… » utilisent `text-accent-texte`, jamais `text-accent`.
    - Constat hors périmètre à signaler : `ServiceAutres.vue` et `ServicesALaUne.vue` (lien `md+`) utilisent encore `text-accent` pour « Voir tous les services ».
11. **Médias orphelins.** Les images de galerie téléversées puis abandonnées (formulaire non enregistré) restent en base et sur disque. Le défaut existe depuis S3, la galerie l'amplifie (jusqu'à 7 téléversements par formulaire). C'est une dette notée, avec un job de nettoyage en S13.
12. **Duplication avec S3.** `resolveEnVedette`, `computeALaUne`, `computeCompteurs`, la génération de slug, le verrou vitrine, la propriété des médias et `truncateForSeo` sont identiques pour S4, S5 et S6. Leur extraction est **simple** (fonctions pures ou helpers de 10 lignes, suites S3 existantes comme filet), donc on factorise.

**Meilleure approche retenue**
- **Galerie dans le corps du formulaire** : `galerie: uuid[]` ordonné dans POST et PUT, en remplacement complet. Pas de routes `POST/DELETE …/images` ni `…/images/reordonner`.
  - Le formulaire enregistre explicitement (bouton « Enregistrer »), et les images sont déjà téléversées via `/api/studio/medias`.
  - Une seule transaction, une seule logique. Même raisonnement que S3 qui a supprimé les PATCH.
- **Studio en `[id]` (uuid), public en `[slug]`**, verrou `FOR UPDATE` sur la vitrine : patron S3 à l'identique.
- **Compteurs de navigation** dans l'enveloppe de `/api/public/:username`.

**À retirer ou simplifier**
- Routes PATCH `visibilite`/`vedette` et routes de galerie dédiées (SPRINTS).
- Visionneuse JS de galerie : simple lien vers la variante 1600.
- Légende ou texte alternatif par image de galerie (hors périmètre, noté).
- PlanService (S10).

**Périmètre réel en plus du brief**
- `server/services/medias.ts` (`deleteMediaIfUnreferenced`).
- `vitrines.ts` + route publique `index.get.ts` + `resources/vitrine.ts` (compteurs `contenus`).
- Les 4 pages publiques S3 (retrait de `:services-total`).
- `usePublicVitrine.ts`, `useStudioNav.ts`.
- `server/exceptions/http.ts` (messages génériques), `e2e/api/services.spec.ts` (constante du message d'ordre).
- Factorisations (§6).
- Seed (ids, rôles inventés).
- U8, `studio-auth.spec.ts`, fabriques.

### Changements par rapport au brief littéral
| Brief ou SPRINTS | Retenu | Raison |
|---|---|---|
| `PATCH …/visibilite`, `PATCH …/vedette` | supprimés, `PUT /realisations/:id` partiel | patron S3 #24 |
| ajout/suppression d'images de galerie par API | `galerie: uuid[]` dans POST/PUT (liste ordonnée, remplacement complet) | une transaction, pas d'état intermédiaire, moins de routes ; plafond garanti en base |
| image principale obligatoire | obligatoire à la création, non retirable mais remplaçable ; colonne nullable (FK SET NULL) | maquette, données existantes, suppression via la route médias (#47) |
| accueil : 1 réalisation à la une | API `aLaUne` ≤ 3 (comme les services), accueil = la 1re | flexibilité si Cabrel veut en montrer 3 (#51) |
| « Votre rôle » (maquette publique) | « Rôle » | le libellé s'adresse au professionnel, pas au visiteur (#55) |
| messages VEDETTE_COMPLETE/ORDRE_INVALIDE propres aux services | génériques, codes partagés par toutes les listes | S5/S6 sans nouveaux codes (#57) |

---

## 0. Décisions par défaut (à confirmer par l'utilisateur)

| # | Sujet | Défaut |
|---|---|---|
| 46 | Galerie | Table `realisation_images` (PROJECT_CONTEXT §11), **6 images max** garanties en base (CHECK `ordre` 0..5 + unicité `(realisation_id, ordre)`). Envoyée comme `galerie: uuid[]` dans POST/PUT, en remplacement complet ; absente du PUT = inchangée |
| 47 | Image principale | Obligatoire à la création, `imageMediaId:null` refusé en PUT (400). Colonne nullable, FK `ON DELETE SET NULL`. Repli visuel (aplat `accent-doux` + icône) si l'image a disparu. N'empêche pas les autres modifications d'une ligne sans image |
| 48 | Paramètres de routes | Studio `[id]` uuid ; public `[username]/realisations/[slug]` |
| 49 | Visibilité et vedette | `PUT /api/studio/realisations/:id` partiel, pas de PATCH |
| 50 | Masquer | Retire la vedette (CHECK `NOT en_vedette OR actif`) ; impossible de mettre en vedette une réalisation masquée |
| 51 | Accueil | L'API renvoie `aLaUne` (vedettes visibles par ordre, ≤ 3 ; repli : les 3 premières visibles). L'accueil n'affiche que **la première** (maquette) |
| 52 | Slug | Généré depuis le titre à la création, jamais modifié, non éditable. Collision → `-2`, `-3`… ; max 80 ; repli `realisation` |
| 53 | Lien externe | http(s) seulement. Une saisie sans schéma (`www.x.cm`) est préfixée `https://`. ≤ 500 caractères. Rendu `target="_blank" rel="noopener noreferrer"` |
| 54 | Année | Facultative, 1900 à 2100. Le formulaire de création est **pré-rempli avec l'année en cours** (la maquette montre « 2025 » saisi, pas en indication) |
| 55 | Libellés des faits publics | « Année », « Lieu », « Rôle » ; une ligne absente n'est pas affichée ; tableau masqué si aucun fait |
| 56 | Navigation publique | `GET /api/public/:username` → `{ vitrine, contenus: { services, realisations } }` (nombre d'éléments visibles). `VitrineCadre`/`VitrineNav` lisent ces compteurs ; la prop `servicesTotal` est supprimée |
| 57 | Codes d'erreur | `VEDETTE_COMPLETE` et `ORDRE_INVALIDE` partagés par toutes les listes, messages rendus génériques ; nouveau code `REALISATION_INTROUVABLE` (404) |
| 58 | Factorisation | `shared/listes.ts`, `shared/schemas/aides.ts`, `server/services/listes-regles.ts`, `server/services/vitrine-acces.ts`, `server/resources/seo.ts`. `services-regles.ts`, `services.ts` et `resources/service.ts` y délèguent, à comportement identique |
| 59 | Bandeau « Un projet en tête ? Parlons-en. » | Bouton « Prendre rendez-vous » vers `/[username]/reserver` (page provisoire S3, #35) |
| 60 | Galerie publique | Grille de vignettes carrées, 2 colonnes (mobile), 3 à partir de `lg`. Chaque image ouvre sa variante 1600 (lien simple, sans visionneuse JS) |
| 61 | Ordre | Liste studio : poignée + flèches (comme S3 #40). Galerie : glisser (`useSortable`) + `ArrowLeft`/`ArrowRight` sur la vignette focalisée |
| 62 | Écrans sans maquette | Page liste publique dérivée de `Page Services · PC` ; détail PC dérivé de `Service · PC` |
| 63 | Plan gratuit (3 réalisations) | Non appliqué en S4 (S10). Points d'insertion documentés en §11 |
| 64 | Seed | 3 réalisations de §15, UUID fixes, image principale générée par sharp, galerie de 4 images sur la 1re. Vedettes : Unité et Campagne (comme la maquette, « 2 en vedette sur 3 »). **Rôle NULL** (aucun inventé). Description de la 1re reprise de la maquette, les 2 autres à fournir par Cabrel (texte neutre provisoire) |
| 65 | Indications des champs | Neutres, pas cardiologiques : Titre « Le nom du projet », Lieu « Ville, établissement ou client », Rôle « Ce que vous y avez fait », Lien « https:// » (écart maquette) |
| 66 | Après « Enregistrer » | Retour à `/studio/realisations` |
| 67 | Bouton du haut « Réserver » des maquettes | Reste « Me contacter » jusqu'à S7 (comme #45) |

## 1. Constats confirmés (audit)

**Routes studio**
- `realisations.[slug].{get,put,delete}.ts` : le point n'est pas un séparateur, ces routes sont inatteignables. Elles figurent dans les exceptions S4 de U8.
- `realisations.{get,post}.ts` :
  - `defineEventHandler` brut, accès db direct ;
  - spread du corps dans l'INSERT (`slug`, `ordre`, `enVedette` acceptés du client, aucun plafond) ;
  - renvoie des lignes ORM ;
  - `imageMediaId` non vérifié (média d'autrui accepté).

**Routes publiques** : absentes. Les pages appellent `/api/public/:u/realisations` qui n'existe pas.

**Schéma**
- `realisations_slug_idx` global non unique, pas d'unicité par vitrine.
- Pas de FK `image_media_id`.
- Aucun CHECK (slug, année, lien, vedette/visibilité).
- Pas de table `realisation_images`.

**Pages**
- Studio : interfaces locales, `[slug].vue`, CSS maison, aucune galerie.
- Public : pas de `VitrineCadre`, `NuxtLink to="/"`, `BsBadge`, titre « Nos réalisations » (la vitrine parle à la première personne : « Mes services »).

**Seed** : ids non UUID, rôles inventés (§15), `ordre` commençant à 1, aucune image (alors qu'elle est obligatoire), une seule vedette.

## 2. Inventaire des fichiers

**Supprimer (6)**
- `server/api/studio/realisations.get.ts`
- `server/api/studio/realisations.post.ts`
- `server/api/studio/realisations.[slug].get.ts`
- `server/api/studio/realisations.[slug].put.ts`
- `server/api/studio/realisations.[slug].delete.ts`
- `app/pages/studio/realisations/[slug].vue`

**Réécrire (6)**
- `shared/schemas/realisation.ts`
- `app/pages/studio/realisations/index.vue`
- `app/pages/studio/realisations/nouveau.vue`
- `app/pages/[username]/realisations/index.vue`
- `app/pages/[username]/realisations/[slug].vue`
- `server/db/seed.ts` (partie réalisations)

**Créer** (liste complète par lot en §10). Routes :
- `server/api/studio/realisations/index.get.ts`
- `server/api/studio/realisations/index.post.ts`
- `server/api/studio/realisations/[id].get.ts`
- `server/api/studio/realisations/[id].put.ts`
- `server/api/studio/realisations/[id].delete.ts`
- `server/api/studio/realisations/reordonner.post.ts`
- `server/api/public/[username]/realisations/index.get.ts`
- `server/api/public/[username]/realisations/[slug].get.ts`

**Modifier hors domaine** (à signaler explicitement dans le rapport, CLAUDE.md §6.6)
- `shared/services.ts` : `VEDETTE_MAX` ré-exporté depuis `./listes`.
- `shared/erreurs.ts`, `server/exceptions/http.ts`.
- `shared/dto/vitrine.ts`, `shared/dto/index.ts`.
- `server/services/{services-regles,services,medias,vitrines}.ts`.
- `server/resources/{service,vitrine}.ts`.
- `server/api/public/[username]/index.get.ts`.
- `app/components/vitrine/{Cadre,Nav}.vue`.
- `app/pages/[username]/{index,services/index,services/[slug],reserver}.vue`.
- `app/composables/{usePublicVitrine,useStudioNav}.ts`.
- `e2e/api/services.spec.ts` (constante du message d'ordre).

**Test U8** (`tests/unit/routes-convention.test.ts`)
- Retirer l'entrée `S4` d'`EXCEPTIONS_PAR_SPRINT`.
- `PLAFOND_EXCEPTIONS` passe de 9 à **6**.
- Le test « exactly 9 » devient « exactly 6, keys S5 and S6 ».
- Ajouter `CIBLES_S4` et le bloc « routes S4 : routes fines », miroir de S3 (`#server/services/realisations`, `#server/resources/realisation`, `#shared/schemas/realisation`).
- Ajouter un test « aucun fichier `realisations.[` » et « aucun `.patch.ts` sous `studio/realisations/` ».

## 3. Migration `0011_s4_realisations.sql`

Le journal s'arrête à idx 10 (`0010_s3_services`) : le prochain numéro est bien **0011**. 0004 reste intacte.

**Procédure** (identique à S3)
1. Modifier `shared/db/schema.ts`.
2. Lancer `pnpm db:generate --name s4_realisations`.
3. **Remplacer** le SQL généré par celui ci-dessous ; `meta/0011_snapshot.json` = snapshot complet de schema.ts.
4. Un second `db:generate` doit répondre « No schema changes ».
5. Tester up → ROLLBACK manuel → up sur la base de test.

```sql
-- S4 : durcissement de realisations + table realisation_images (docs/specs/S4-realisations.md §3).
-- Écrite à la main (comme 0009/0010) : normalisation des données AVANT les contraintes.
-- Listes et bornes recopiées en dur ; source applicative : shared/realisations.ts et shared/listes.ts.

-- 1. Remise en conformité des données existantes (développement). Instructions idempotentes.
UPDATE realisations SET description = NULL WHERE description IS NOT NULL AND btrim(description) = '';
--> statement-breakpoint
UPDATE realisations SET lieu = NULLIF(btrim(lieu), ''), role = NULLIF(btrim(role), '');
--> statement-breakpoint
UPDATE realisations SET lien = 'https://' || btrim(lien)
  WHERE lien IS NOT NULL AND btrim(lien) !~* '^[a-z][a-z0-9+.-]*:' AND btrim(lien) ~* '^[a-z0-9-]+(\.[a-z0-9-]+)+(/.*)?$';
--> statement-breakpoint
UPDATE realisations SET lien = NULL
  WHERE lien IS NOT NULL AND (btrim(lien) !~* '^https?://[^[:space:]]+$' OR char_length(lien) > 500);
--> statement-breakpoint
UPDATE realisations SET lien = btrim(lien) WHERE lien IS NOT NULL;
--> statement-breakpoint
UPDATE realisations SET annee = NULL WHERE annee IS NOT NULL AND annee NOT BETWEEN 1900 AND 2100;
--> statement-breakpoint
UPDATE realisations SET ordre = 0 WHERE ordre < 0;
--> statement-breakpoint
UPDATE realisations SET en_vedette = false WHERE actif = false;
--> statement-breakpoint
UPDATE realisations r SET en_vedette = false FROM (
  SELECT id, row_number() OVER (PARTITION BY vitrine_id ORDER BY ordre, created_at, id) AS rang
  FROM realisations WHERE en_vedette) v
  WHERE r.id = v.id AND v.rang > 3;
--> statement-breakpoint
UPDATE realisations r SET image_media_id = NULL WHERE image_media_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM medias m JOIN vitrines v ON v.user_id = m.user_id
  WHERE m.id = r.image_media_id AND v.id = r.vitrine_id);
--> statement-breakpoint
UPDATE realisations SET slug = 'realisation-' || substr(md5(id), 1, 8)
  WHERE char_length(slug) NOT BETWEEN 1 AND 80 OR slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
--> statement-breakpoint
UPDATE realisations r SET slug = rtrim(left(r.slug, 71), '-') || '-' || substr(md5(r.id), 1, 8)
  WHERE EXISTS (SELECT 1 FROM realisations o WHERE o.vitrine_id = r.vitrine_id AND o.slug = r.slug AND o.id < r.id);
--> statement-breakpoint

-- 2. Index : unicité PAR vitrine (sert aussi les recherches par vitrine_id).
DROP INDEX IF EXISTS realisations_slug_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS realisations_actif_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS realisations_vitrine_id_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX realisations_vitrine_id_slug_unique ON realisations (vitrine_id, slug);
--> statement-breakpoint

-- 3. Image principale = ligne medias.
ALTER TABLE realisations ADD CONSTRAINT realisations_image_media_id_medias_id_fk
  FOREIGN KEY (image_media_id) REFERENCES medias(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX realisations_image_media_id_idx ON realisations (image_media_id);
--> statement-breakpoint

-- 4. Contraintes (structurelles et de sécurité ; les longueurs de texte restent dans Zod, comme S3).
ALTER TABLE realisations
  ADD CONSTRAINT realisations_slug_format_check CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT realisations_annee_check CHECK (annee IS NULL OR annee BETWEEN 1900 AND 2100),
  ADD CONSTRAINT realisations_lien_check CHECK (lien IS NULL OR (char_length(lien) <= 500 AND lien ~* '^https?://')),
  ADD CONSTRAINT realisations_ordre_check CHECK (ordre >= 0),
  ADD CONSTRAINT realisations_vedette_actif_check CHECK (NOT en_vedette OR actif);
--> statement-breakpoint

-- 5. Galerie : 6 images au plus, garanti par ordre ∈ [0,5] + unicité (realisation_id, ordre).
CREATE TABLE realisation_images (
  id text PRIMARY KEY NOT NULL,
  realisation_id text NOT NULL,
  media_id text NOT NULL,
  ordre integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT realisation_images_realisation_id_realisations_id_fk
    FOREIGN KEY (realisation_id) REFERENCES realisations(id) ON DELETE CASCADE,
  CONSTRAINT realisation_images_media_id_medias_id_fk
    FOREIGN KEY (media_id) REFERENCES medias(id) ON DELETE CASCADE,
  CONSTRAINT realisation_images_ordre_check CHECK (ordre BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX realisation_images_realisation_id_ordre_unique ON realisation_images (realisation_id, ordre);
--> statement-breakpoint
CREATE UNIQUE INDEX realisation_images_realisation_id_media_id_unique ON realisation_images (realisation_id, media_id);
--> statement-breakpoint
CREATE INDEX realisation_images_media_id_idx ON realisation_images (media_id);

-- ROLLBACK (manuel, dans une transaction ; STRUCTUREL : les normalisations du §1 ne sont pas réversibles,
-- et le contenu des galeries est perdu).
-- BEGIN;
-- DROP TABLE realisation_images;
-- ALTER TABLE realisations
--   DROP CONSTRAINT realisations_vedette_actif_check, DROP CONSTRAINT realisations_ordre_check,
--   DROP CONSTRAINT realisations_lien_check, DROP CONSTRAINT realisations_annee_check,
--   DROP CONSTRAINT realisations_slug_format_check;
-- DROP INDEX realisations_image_media_id_idx;
-- ALTER TABLE realisations DROP CONSTRAINT realisations_image_media_id_medias_id_fk;
-- DROP INDEX realisations_vitrine_id_slug_unique;
-- CREATE INDEX realisations_vitrine_id_idx ON realisations (vitrine_id);
-- CREATE INDEX realisations_slug_idx ON realisations (slug);
-- CREATE INDEX realisations_actif_idx ON realisations (actif);
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <when de l'idx 11 dans _journal.json>;
-- COMMIT;
```

**Choix des FK de la galerie**
- `media_id ON DELETE CASCADE` : supprimer un média (route médias ou suppression de compte) retire la vignette, sans trou dans la galerie publique.
- La protection contre une suppression involontaire est assurée par `deleteMediaIfUnreferenced`, qui doit connaître cette table (§6).
- **L'image principale reste en `SET NULL`** (patron services et vitrine).

**`shared/db/schema.ts`**
- Table `realisations` :
  - `imageMediaId.references(() => medias.id, { onDelete: 'set null' })` ;
  - index `uniqueIndex('realisations_vitrine_id_slug_unique')` et `index('realisations_image_media_id_idx')` ;
  - les 5 `check()` ;
  - suppression des 3 anciens index ;
  - commentaire « listes synchronisées avec shared/realisations.ts ».
- Nouvelle table `realisationImages` (`realisation_images`) :
  - colonnes `id`, `realisationId`, `mediaId`, `ordre`, `createdAt` ;
  - les 2 FK ;
  - 2 `uniqueIndex`, 1 `index`, 1 `check`.

**Seed (`server/db/seed.ts`)**

UUID fixes. Le seed supprime d'abord les réalisations de la vitrine de démo absentes de sa liste (anciens ids `seed-real-*`), puis fait un upsert.

| Réalisation | Année | Lieu | Rôle | Vedette | Ordre | Image | Galerie |
|---|---|---|---|---|---|---|---|
| Unité de cathétérisme, CHU de Douala | 2025 | CHU de Douala | NULL | oui | 0 | générée | 4 générées |
| Campagne de dépistage de l'hypertension | 2024 | Douala | NULL | oui | 1 | générée | — |
| Programme de réadaptation cardiaque | 2022 | Douala | NULL | non | 2 | générée | — |

- Description de la 1re : « Mise en place et coordination d'une unité dédiée aux actes de cardiologie interventionnelle. » (maquette).
- Les 2 autres : une phrase neutre, sans chiffre, **signalée** pour validation par Cabrel (#64).
- Images : `creerPhotoDemo()` (aplat sharp) téléversée via `uploadMedia`.
- Idempotence : image principale réutilisée si elle existe encore ; galerie de la 1re remplacée seulement si elle ne compte pas 4 lignes.
- Pas de `lien` en seed (aucune URL inventée).

## 4. Contrats partagés (`shared/`)

### `shared/listes.ts` (nouveau, pur)
- `VEDETTE_MAX = 3`, déplacé ici. `shared/services.ts` le remplace par `export { VEDETTE_MAX } from './listes'` : tous les imports S3 restent valides.
- `LISTE_SLUG_MAX = 80`, `LISTE_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/`, `LISTE_REORDER_MAX = 200`.

### `shared/realisations.ts` (nouveau, pur)

**Constantes** (recopiées dans les CHECK)
- `REALISATION_TITRE_MAX = 100`, `REALISATION_DESCRIPTION_MAX = 2000`
- `REALISATION_LIEU_MAX = 100`, `REALISATION_ROLE_MAX = 100`, `REALISATION_LIEN_MAX = 500`
- `ANNEE_MIN = 1900`, `ANNEE_MAX = 2100`
- `GALERIE_MAX = 6`
- `REALISATION_SLUG_REPLI = 'realisation'`
- `AUTRES_REALISATIONS_MAX = 2`

**Libellés** : `REALISATION_FAITS_LIBELLES = { annee: 'Année', lieu: 'Lieu', role: 'Rôle' }`.

**Fonctions pures**
- `normaliserLien(valeur: unknown): unknown`
  - chaîne rognée ; `''` → `null` ;
  - sans schéma (`!/^[a-z][a-z0-9+.-]*:/i`) → préfixe `https://` ;
  - une autre valeur que chaîne est renvoyée telle quelle.
- `metaRealisation({ annee, lieu })` → `'2025 · Douala'` | `'2025'` | `'Douala'` | `''`.
- `metaRealisationStudio({ annee, lieu, actif })` → `metaRealisation` + `' · Masqué'` si masquée ; `'Masqué'` seul si pas de méta.
- `surtitreRealisation(annee)` → `'Réalisation · 2025'` | `'Réalisation'`.
- `resumeListeRealisations(visibles, enVedette, max)` → `'4 visibles · 2 en vedette sur 3'` (`'1 visible'`, `'0 visible'`).
- `libelleVedetteRealisations(n, max)` → `'2 réalisations sur 3 en vedette.'` (`'0 réalisation'`, `'1 réalisation'`).
- `realisationsHref(username)`, `realisationDetailHref(username, slug)`.
- `anneeCourante(): number` (`new Date().getFullYear()`, isolé pour le test).

### `shared/schemas/aides.ts` (nouveau)
- `blankToNull` et `nullable(schema)` : même code que `schemas/service.ts`.
- Seul `schemas/realisation.ts` l'utilise en S4. `service.ts` et `vitrine.ts` gardent leur copie (dette notée, sans risque).

### `shared/schemas/realisation.ts` (réécrit)

**`champs`**
- `titre` : trim, 1 à 100 (« Le titre est requis. » / « … limité à 100 caractères. »).
- `description` : `nullable(z.string().max(2000))`.
- `imageMediaId` : `z.uuid({ error: (iss) => iss.input == null ? 'Ajoutez une image principale.' : 'Image invalide.' })`. **Non nullable.** Vérifier la syntaxe exacte de l'option `error` de Zod 4 installé.
- `galerie` : `z.array(z.uuid('Image invalide.')).max(GALERIE_MAX, 'La galerie compte 6 images au maximum.')` + refine sans doublon (`path:['galerie']`, « Une image ne peut apparaître qu'une fois dans la galerie. »).
- `annee` : `z.int('L'année doit être un nombre entier.').min(1900, …).max(2100, …).nullable()`.
- `lieu`, `role` : `nullable(z.string().max(100))`.
- `lien` : `z.preprocess(normaliserLien, z.url({ protocol: /^https?$/, hostname: z.regexes.domain, error: 'Saisissez une adresse web valide, par exemple https://exemple.com.' }).max(500).nullable())`.
  - Si `z.regexes.domain` n'existe pas dans la version installée : refine `new URL(v).hostname.includes('.')`.
- `enVedette`, `actif` : `z.boolean()`.

**Schémas**
- `schemaRealisationCreate` : `.strict()`, avec ces champs :
  - `titre` ;
  - `imageMediaId` **requis** ;
  - `description`/`annee`/`lieu`/`role`/`lien` → `.default(null)` ;
  - `galerie` → `.default([])` ;
  - `actif` → `.default(true)` ;
  - `enVedette` **optionnel sans défaut** (= automatique).
- `schemaRealisationUpdate = z.object(champs).partial().strict().refine(non vide, 'Aucune modification à enregistrer.')`. `imageMediaId` y reste non nullable : envoyer `null` donne 400.
- `schemaRealisationReorder` : `{ ids: z.array(z.uuid()).min(1).max(LISTE_REORDER_MAX) }`, strict, sans doublon.
- `slug`, `ordre`, `vitrineId`, `id` sont interdits (strict → 400).
- Types exportés : `RealisationCreateInput`, `RealisationCreateRaw`, `RealisationUpdateInput`, `RealisationReorderInput`.

### `shared/dto/realisation.ts` (nouveau) + ré-exports dans `shared/dto/index.ts`

```ts
RealisationStudioDTO { id; slug; titre; description: string|null; image: MediaDTO|null; galerie: MediaDTO[] /*ordre*/;
  annee: number|null; lieu: string|null; role: string|null; lien: string|null;
  enVedette: boolean; actif: boolean; ordre: number; creeLe: string; modifieLe: string }
RealisationsCompteursDTO { total; visibles; enVedette; vedetteMax }
RealisationPublicCarteDTO { slug; titre; description: string|null; image: MediaDTO|null; annee: number|null; lieu: string|null }
RealisationPublicDetailDTO extends RealisationPublicCarteDTO { role: string|null; lien: string|null; galerie: MediaDTO[];
  seo: { titre: string; description: string } }
RealisationsStudioReponse { realisations: RealisationStudioDTO[]; compteurs: RealisationsCompteursDTO }
RealisationStudioReponse  { realisation: RealisationStudioDTO; compteurs: RealisationsCompteursDTO }
RealisationsPublicsReponse { total: number; aLaUne: RealisationPublicCarteDTO[]; realisations: RealisationPublicCarteDTO[] }
RealisationPublicReponse  { realisation: RealisationPublicDetailDTO; autres: RealisationPublicCarteDTO[]; total: number }
```

Le DTO public ne contient **jamais** : `id` de la réalisation, `vitrineId`, `ordre`, `actif`, `enVedette`, dates, `imageMediaId`, chemin disque. Le `MediaDTO` des images contient l'`id` du média, comme la photo de vitrine en S2.

### `shared/dto/vitrine.ts`
- Ajouter `ContenusPublicsDTO { services: number; realisations: number }` (nombre d'éléments **visibles**).
- Ajouter `VitrinePubliqueReponse { vitrine: VitrinePubliqueDTO; contenus: ContenusPublicsDTO }`.
- `VitrinePubliqueDTO` **inchangé**.

### `shared/erreurs.ts` et `server/exceptions/http.ts`
- Nouveau code `REALISATION_INTROUVABLE` (404), message « Cette réalisation est introuvable. »
- `VEDETTE_COMPLETE` devient générique : `` `Vous avez déjà ${VEDETTE_MAX} éléments en vedette. Retirez-en un pour en mettre un autre en avant.` `` Le studio compose son propre texte à partir de `data.enVedette`, comme S3.
- `ORDRE_INVALIDE` devient générique : « L'ordre envoyé n'est plus à jour. Rechargez la page et réessayez. »
- `http.ts` importe `VEDETTE_MAX` depuis `shared/listes`.
- `ErrorData.enVedette` est inchangé (déjà `{id, titre}[]`).

## 5. Contrats API

Format d'erreur identique à S2 §5 et S3 §5. Toutes les routes `/api/studio/**` répondent 401 sans session, **avant** toute validation. Aucune route ne renvoie un objet ORM.

| Méthode, chemin | Corps | Succès | Erreurs |
|---|---|---|---|
| GET `/api/studio/realisations` | — | 200 `RealisationsStudioReponse` (tri `ordre`, `creeLe`, `id` ; masquées incluses ; galerie de chaque élément) | 404 VITRINE_INTROUVABLE |
| POST `/api/studio/realisations` | `schemaRealisationCreate` | **201** `RealisationStudioReponse` | 400 VALIDATION (`champs`), 404 VITRINE_INTROUVABLE, 409 VEDETTE_COMPLETE (`enVedette`), 422 MEDIA_INVALIDE |
| GET `/api/studio/realisations/:id` | — | 200 `RealisationStudioReponse` | 400 (non uuid), 404 REALISATION_INTROUVABLE / VITRINE_INTROUVABLE |
| PUT `/api/studio/realisations/:id` | `schemaRealisationUpdate` (partiel ; `galerie` = remplacement complet) | 200 `RealisationStudioReponse` | 400, 404, 409 VEDETTE_COMPLETE, 422 MEDIA_INVALIDE |
| DELETE `/api/studio/realisations/:id` | — | **204** | 400, 404 |
| POST `/api/studio/realisations/reordonner` | `{ ids }` = permutation exacte de TOUTES les réalisations de la vitrine | 200 `RealisationsStudioReponse` | 400, 404, 422 ORDRE_INVALIDE |
| GET `/api/public/:username/realisations` | — | 200 `RealisationsPublicsReponse` (vitrine publiée ; visibles ; listes vides si aucune) | 404 VITRINE_INTROUVABLE |
| GET `/api/public/:username/realisations/:slug` | — | 200 `RealisationPublicReponse` | 404 VITRINE_INTROUVABLE, 404 REALISATION_INTROUVABLE (masquée, inconnue, autre vitrine, format invalide sans requête) |
| GET `/api/public/:username` (**modifiée**) | — | 200 `VitrinePubliqueReponse` = `{ vitrine, contenus: { services, realisations } }` | inchangées |

**Règles métier** (portées par le service, jamais par la route)
- **R1 Image principale** : obligatoire à la création (Zod). `imageMediaId:null` en PUT donne 400 (Zod). Une ligne existante sans image n'est **pas** bloquée pour les autres modifications.
- **R2 Galerie** :
  - ≤ 6, sans doublon (Zod) ;
  - sur l'**état fusionné**, la galerie ne contient pas l'image principale, sinon 400 `champs.galerie` « Cette image est déjà l'image principale. » ;
  - `galerie` présente = remplacement complet, l'ordre du tableau devient `ordre` 0..n−1 ; absente = inchangée.
- **R3 Propriété** : l'image principale (si changée) et chaque image de galerie appartiennent à l'utilisateur. Une seule requête `WHERE id = ANY($ids) AND user_id = $u`, compte comparé. Sinon 422 MEDIA_INVALIDE, rien n'est persisté.
- **R4 Normalisation** : `actif=false` sans `enVedette` explicite ⇒ `enVedette=false`.
- **R5** : `enVedette=true` et `actif=false` dans l'état fusionné ⇒ 400 `champs.enVedette` « Une réalisation masquée ne peut pas être en vedette. »
- **R6 Plafond** `VEDETTE_MAX`, sémantique identique à S3 R7 :
  - automatique à la création (vrai si moins de 3 vedettes et visible) ;
  - demande explicite au-delà ⇒ 409 avec `data.enVedette` (ordre) ;
  - une réalisation déjà en vedette ne se compte pas.
- **R7 Slug et ordre** : slug généré du titre (#52) ; `ordre = max + 1`.
- **R8 Nettoyage après commit** : médias retirés = (ancienne image ∪ ancienne galerie) − (nouvelle image ∪ nouvelle galerie). Chacun passe par `deleteMediaIfUnreferenced`. Un échec est journalisé sans PII.
- **R9 Public** :
  - `aLaUne` = vedettes visibles (ordre), sinon les 3 premières visibles ;
  - `autres` = 2 autres visibles au plus (ordre), hors courante ;
  - `username` et `slug` passent par `trim().toLowerCase()` ; format invalide ⇒ 404 sans requête.
- **R10 Contenus** : nombre de services et de réalisations `actif = true` d'une vitrine publiée, en une requête.

**SEO du détail** (dans le DTO)
- `seo.titre = "${titre} — ${nomAffiche}"`.
- `seo.description` = description tronquée à 160 caractères (`truncateForSeo`), sinon `"${titre}, une réalisation de ${nomAffiche}, ${metier}${ville ? ` à ${ville}` : ''}."`.

## 6. Découpage serveur

**Factorisations (#58)** : comportement identique, les suites S3 servent de filet.
- **`server/services/listes-regles.ts`** (pur) :
  - `resolveEnVedette`, `computeALaUne`, `computeCompteurs`, types `Compteurs` et `ResolveEnVedetteInput` (code **déplacé** depuis `services-regles.ts`) ;
  - `slugFromText(texte, { max, repli })` ;
  - `pickAvailableSlug(base, existants, max)`.
- **`server/services/services-regles.ts`** : ré-exporte les trois fonctions et le type ; `slugFromTitle` et `pickAvailableSlug` deviennent des enveloppes (`max = SERVICE_SLUG_MAX`, repli `service`). U13 et U14 **inchangés** doivent rester verts.
- **`server/services/vitrine-acces.ts`** : types `Executor`, `Transaction` ; fonctions :
  - `requireVitrineId(userId)` ;
  - `lockVitrineId(tx, userId)` ;
  - `requireOwnedMedias(tx, userId, ids)` ;
  - `cleanupMedias(userId, ids, contexte)`.

  Ce sont les helpers privés actuels de `services.ts`, `requireOwnedMedia` étant généralisé à une liste. `services.ts` les importe et supprime ses copies (tâche L3c, isolable).
- **`server/resources/seo.ts`** : `truncateForSeo` et `SEO_DESCRIPTION_MAX`, déplacés depuis `resources/service.ts`, qui les importe. U17 doit rester vert.

**Nouveaux**
- **`server/services/realisations-regles.ts`** (pur) :
  - `RealisationState { imageMediaId: string|null; galerie: string[]; actif; enVedette }` ;
  - `normalizeRealisationState(etat, patch)` (R4) ;
  - `checkRealisationCoherence(etat)` (R2 principale ∉ galerie, R5) ;
  - `slugFromTitreRealisation(titre)` ;
  - `mediasARetirer(avant, apres): string[]` (R8, sans doublon, sans null).
- **`server/services/realisations.ts`** (aucun `event`) :
  - `listOwnRealisations(userId)`, `getOwnRealisation(userId, id)`.
  - `createRealisation(userId, input)` :
    - transaction + `lockVitrineId` ;
    - normalisation, cohérence (sinon `ValidationError`) ;
    - R3 sur `[imageMediaId, ...galerie]`, R6 ;
    - slug, puis INSERT de la réalisation et INSERT multi-lignes de la galerie ;
    - 23505 sur `realisations_vitrine_id_slug_unique` : une nouvelle tentative ;
    - 23503 sur l'une des FK média ⇒ MEDIA_INVALIDE.
  - `updateRealisation(userId, id, patch)` :
    - verrou vitrine ; ligne courante filtrée par vitrine (sinon REALISATION_INTROUVABLE) ; galerie courante ;
    - fusion → cohérence → R3 sur les seuls ids **nouveaux** → R6 → UPDATE ;
    - si `galerie` est fournie : `DELETE FROM realisation_images WHERE realisation_id=$id`, puis INSERT ;
    - après commit : `cleanupMedias(mediasARetirer(...))`.
  - `deleteRealisation(userId, id)` : transaction (lecture des `media_id` de galerie, DELETE … RETURNING `image_media_id` ; aucune ligne ⇒ 404), puis nettoyage après commit.
  - `reorderRealisations(userId, ids)` : patron S3 (verrou, permutation exacte, `UPDATE … FROM unnest WITH ORDINALITY`).
  - `getPublicRealisations(rawUsername)`, `getPublicRealisation(rawUsername, rawSlug)` : réutilisent `getPublicVitrine`.
  - **Galeries** : une seule requête `realisation_images JOIN medias WHERE realisation_id = ANY($ids) ORDER BY realisation_id, ordre`, regroupée en mémoire. Jamais de N+1.
  - Renvoient lignes, images et galeries ; jamais de DTO.
- **`server/resources/realisation.ts`** :
  - `toRealisationStudioResource(row, image, galerie)`, `toRealisationsCompteursResource` ;
  - `toRealisationPublicCarteResource(row, image)` ;
  - `toRealisationPublicDetailResource(row, image, galerie, vitrine)` ;
  - listes blanches explicites, jamais de spread.

**Modifiés**
- **`server/services/medias.ts`** : `deleteMediaIfUnreferenced` ajoute `notExists(select 1 from realisation_images where media_id = $m)`. Commentaire mis à jour.
- **`server/services/vitrines.ts`** : `getPublicVitrinePage(rawUsername): { vitrine: VitrineAvecPhoto; contenus: { services; realisations } }`. Il appelle `getPublicVitrine` puis exécute une requête de deux sous-comptes `actif = true`. `getPublicVitrine` est **inchangée** (utilisée par services et réalisations).
- **`server/resources/vitrine.ts`** : `toContenusPublicsResource`.
- **`server/api/public/[username]/index.get.ts`** : `{ vitrine: toVitrinePublicResource(page.vitrine), contenus: toContenusPublicsResource(page.contenus) }`.

**Routes** : patron S3 strict.
- `defineApiHandler` ; `requireUserSession` en premier ; `readParamsWith(z.object({ id: z.uuid() }))` ; `readBodyWith(schema…)` ; service ; ressource.
- `setResponseStatus(event, 201)` sur POST ; `sendNoContent` sur DELETE.
- Côté public, paramètres en `z.string()`.

## 7. Critères d'acceptation (Given/When/Then)

Identifiants `S4-CA`. Sauf mention contraire :
- **A** a une vitrine publiée `dr-test` (Dr Cabrel Nguesso, Cardiologue, Douala) ;
- **B** est un autre utilisateur ;
- M1, M2… sont des médias de A, MB un média de B ;
- tous les appels passent par les vrais services, la vraie base et le vrai disque.

### Base
- **S4-CA01 Migration**
  - **Given** une base en 0010 contenant :
    - deux réalisations `slug='projet'` dans la même vitrine ;
    - un slug `Mon Slug!` ;
    - une image de B sur une réalisation de A ;
    - 4 vedettes, plus une vedette masquée ;
    - `lien='javascript:alert(1)'`, `lien='www.chu-douala.cm'`, `lien='  https://x.cm  '` ;
    - `annee=1800`, `ordre=-1`, `description='  '`.
  - **When** 0011 est appliquée.
  - **Then** :
    - doublon → `projet-<8 hex>` ; slug invalide → `realisation-<8 hex>` ;
    - image de B → NULL ;
    - 3 vedettes max (ordre), vedette masquée → false ;
    - `javascript:` → NULL ; `www.…` → `https://www.chu-douala.cm` ; espaces rognés ;
    - année NULL, ordre 0, description NULL ;
    - `realisation_images` existe et est vide ;
    - up → ROLLBACK → up passe.
- **S4-CA02 CHECK** : **When** un INSERT direct contient l'un de ces cas :
  - slug `Bad Slug` ; `annee` 1899 ; `lien` `javascript:alert(1)` ; `lien` `ftp://x.cm` ; `en_vedette` vrai et `actif` faux ; `ordre` −1 ;
  - une image de galerie avec `ordre` 6.

  **Then** chacun est rejeté (23514).
- **S4-CA03 Unicité**
  - même slug dans 2 vitrines → OK ;
  - même slug dans la même vitrine → 23505 `realisations_vitrine_id_slug_unique` ;
  - même `(realisation_id, ordre)` → 23505 ;
  - même `(realisation_id, media_id)` → 23505.
- **S4-CA04 Plafond en base** : **Given** 6 images (ordres 0 à 5). **When** une 7e est insérée, quel que soit son ordre. **Then** rejet (23514 ou 23505).
- **S4-CA05 FK**
  - supprimer le média de l'image principale → `image_media_id` NULL ;
  - supprimer un média de galerie → la ligne `realisation_images` disparaît ;
  - supprimer la réalisation → ses lignes de galerie disparaissent, les `medias` restent.

### Création
- **S4-CA06 Nominal**
  - **Given** A sans réalisation.
  - **When** `createRealisation(A, {titre:'Unité de cathétérisme, CHU de Douala', imageMediaId:M1, annee:2025, lieu:'CHU de Douala'})`.
  - **Then** :
    - slug `unite-de-catheterisme-chu-de-douala`, ordre 0 ;
    - actif, `enVedette` true, `galerie []`, `role`/`lien`/`description` null ;
    - `image.url = /medias/M1/1600.webp` ;
    - compteurs `{total:1, visibles:1, enVedette:1, vedetteMax:3}`.
- **S4-CA07 Image obligatoire**
  - POST sans `imageMediaId` → 400, `champs.imageMediaId[0]` = « Ajoutez une image principale. », aucune ligne insérée ;
  - `imageMediaId:null` → même résultat.
- **S4-CA08 Vedette automatique** : 4 créations sans `enVedette` → `[true,true,true,false]`. Avec `enVedette:false` en 1re, puis 4 sans le champ → `[false,true,true,true,false]`.
- **S4-CA09 Plafond à la création** : **Given** 3 vedettes. **When** une création avec `enVedette:true`. **Then** 409 VEDETTE_COMPLETE, `data.enVedette` = les 3 `{id,titre}` dans l'ordre, rien n'est inséré.
- **S4-CA10 Slugs**
  - `'Dépistage cœur & poumons'` → `depistage-coeur-et-poumons`
  - même titre une 2e fois → `-2`, une 3e fois → `-3`
  - `'!!!'` → `realisation`
  - titre de 100 caractères accentués → slug ≤ 80 sans tiret final
  - même titre chez B → sans suffixe
- **S4-CA11 Validation** (400, champ visé) :
  - titre vide ou de 101 caractères → `titre`
  - description de 2001 caractères → `description`
  - `annee` 1899, 2101 ou 2025.5 → `annee`
  - `lien` `javascript:alert(1)`, `ftp://x.cm`, `https://` seul, 501 caractères → `lien`
  - 7 images en galerie, doublon, `'abc'` → `galerie`
  - clés `slug`, `ordre`, `vitrineId` → 400 (strict)
- **S4-CA12 Normalisation du lien** :
  - `'www.chu-douala.cm'` → `https://www.chu-douala.cm`
  - `'  https://x.cm/p  '` → `https://x.cm/p`
  - `''` → `null`
  - `'HTTP://X.CM'` → accepté
- **S4-CA13 Galerie à la création** : `galerie:[G1,G2,G3]` → DTO `galerie` ids `[G1,G2,G3]`, lignes `ordre` 0, 1, 2.
- **S4-CA14** : `imageMediaId:M1, galerie:[G1,M1]` → 400 `champs.galerie` « Cette image est déjà l'image principale. »
- **S4-CA15 Propriété** : l'image principale MB, un id inconnu, ou `galerie:[G1,MB]` → 422 MEDIA_INVALIDE ; ni réalisation ni galerie persistées.
- **S4-CA16** : utilisateur sans vitrine → 404 VITRINE_INTROUVABLE.

### Mise à jour
- **S4-CA17** : PUT `{description:'x'}` ne change que `description` et `modifieLe` ; galerie et image intactes.
- **S4-CA18** : PUT `{titre:'Nouveau'}` laisse le slug inchangé.
- **S4-CA19 Image principale**
  - PUT `{imageMediaId:null}` → 400 `imageMediaId`.
  - PUT `{imageMediaId:M2}` (avant : M1) → M1 supprimé (ligne et 3 fichiers) après le commit.
  - Si M1 est aussi la photo de la vitrine, l'image d'un service ou une image de galerie d'une autre réalisation → conservé.
- **S4-CA20 Remplacement de galerie**
  - **Given** `[G1,G2,G3]`.
  - **When** PUT `{galerie:[G3,G1]}`. **Then** ordre `[G3,G1]`, G2 supprimé (ligne `medias` et fichiers).
  - **When** PUT `{galerie:[]}`. **Then** galerie vide, G3 et G1 supprimés.
- **S4-CA21 Échange** : **Given** image M1, galerie `[G1]`. **When** PUT `{imageMediaId:G1, galerie:[M1]}`. **Then** 200, aucun média supprimé.
- **S4-CA22** : **Given** galerie `[G1]`. **When** PUT `{imageMediaId:G1}` sans `galerie`. **Then** 400 `galerie`, base inchangée.
- **S4-CA23 Plafond à la mise à jour**
  - **Given** R1, R2, R3 en vedette.
  - PUT R4 `{enVedette:true}` → 409 (titres R1 à R3).
  - PUT R2 `{enVedette:false}` puis R4 `{enVedette:true}` → 200.
  - PUT R1 `{enVedette:true}` (déjà en vedette) → 200.
- **S4-CA24 Masquer**
  - `{actif:false}` → `enVedette` false, compteurs `visibles` −1 et `enVedette` −1.
  - `{actif:false, enVedette:true}` → 400 `enVedette`.
  - Réalisation masquée + `{enVedette:true}` → 400.
- **S4-CA25 Ligne ancienne** : **Given** une réalisation insérée avec `image_media_id` NULL. **When** PUT `{actif:false}`. **Then** 200 (l'image n'est exigée qu'à la création ou sur un `null` explicite).
- **S4-CA26 Concurrence**
  - 2 vedettes, `Promise.all` de PUT `{enVedette:true}` sur R3 et R4 → exactement un 200 et un 409 ; 3 vedettes en base.
  - 2 créations simultanées « Bilan » → slugs `bilan` et `bilan-2`.
  - 2 PUT simultanés `{galerie:[G1,G2]}` et `{galerie:[G3]}` sur la même réalisation → la galerie finale vaut exactement l'une des deux listes ; aucune erreur non métier.
- **S4-CA27 Isolation** : GET, PUT et DELETE par B d'une réalisation de A → 404 REALISATION_INTROUVABLE ; la réalisation de A est intacte.
- **S4-CA28** : PUT `{}` → 400.

### Suppression et ordre
- **S4-CA29 Suppression**
  - DELETE → 204 ; réalisation et lignes de galerie absentes ; image principale et images de galerie supprimées si non référencées ailleurs.
  - Une vedette supprimée libère sa place : la création suivante est automatiquement en vedette.
- **S4-CA30** : DELETE d'un uuid inconnu → 404 REALISATION_INTROUVABLE.
- **S4-CA31 Réordonnancement** : `reorder([R3,R1,R2])` → ordres 0, 1, 2 dans cet ordre ; la liste studio et la liste publique suivent.
- **S4-CA32 Ordre invalide** : liste incomplète, doublon, id de B, ou id inconnu en plus → 422 ORDRE_INVALIDE, message « L'ordre envoyé n'est plus à jour. Rechargez la page et réessayez. », ordres inchangés.
- **S4-CA33 Liste studio** : **Given** 4 réalisations (3 visibles, 2 vedettes), dont l'une a 2 images de galerie. **Then** 4 éléments dans l'ordre, la galerie de chacun en ordre, compteurs `{4,3,2,3}`.

### Public
- **S4-CA34** : `getPublicRealisations('dr-test')` → `realisations` = visibles dans l'ordre ; `total` = 3 ; `aLaUne` = les vedettes ; la masquée est absente partout.
- **S4-CA35 Repli** : aucune vedette, 4 visibles → `aLaUne` = les 3 premières.
- **S4-CA36** : vitrine publiée sans réalisation visible → `{total:0, aLaUne:[], realisations:[]}`.
- **S4-CA37** : vitrine non publiée, inconnue, ou `Bad_Name` → 404 VITRINE_INTROUVABLE.
- **S4-CA38 Détail**
  - slug visible → `realisation` (galerie en ordre) + `autres` (≤ 2, sans la courante, dans l'ordre) + `total` ;
  - masquée, slug d'une autre vitrine, ou `bad_slug!` (sans requête) → 404 REALISATION_INTROUVABLE ;
  - `UNITE-DE-CATHETERISME-CHU-DE-DOUALA` → trouvée.
- **S4-CA39 Liste blanche**
  - Les clés sont **exactement** celles de `RealisationPublicCarteDTO` / `RealisationPublicDetailDTO`.
  - Le JSON ne contient ni `vitrineId`, ni `ordre`, ni `actif`, ni `enVedette`, ni `imageMediaId`, ni `creeLe`, ni le userId, ni `chemin`.
  - `seo.titre` = `'Unité de cathétérisme, CHU de Douala — Dr Cabrel Nguesso'`.
  - Description de 300 caractères → `seo.description` ≤ 160.
  - Sans description → `'Unité de cathétérisme, CHU de Douala, une réalisation de Dr Cabrel Nguesso, Cardiologue à Douala.'`
- **S4-CA40** : après `{actif:false}`, la réalisation disparaît de `realisations` et de `aLaUne`, et son détail répond 404.
- **S4-CA41 Contenus**
  - **Given** 5 services visibles + 1 masqué, 3 réalisations visibles + 1 masquée.
  - **When** `GET /api/public/dr-test`.
  - **Then** `contenus` = `{services:5, realisations:3}` ; les clés de `vitrine` sont inchangées (S2 CA13 vert).

### Médias
- **S4-CA42** : **Given** G1 dans la galerie de R1. **When** `deleteMediaIfUnreferenced(A, G1)`. **Then** G1 est conservé. **When** R1 est supprimée puis le nettoyage relancé. **Then** G1 est supprimé.

### Transversal, HTTP et UI
- **S4-CA43** : sans session → 401 pour :
  - GET/POST `/api/studio/realisations` ;
  - GET/PUT/DELETE `/api/studio/realisations/<uuid>` ;
  - POST `/reordonner` ;
  - GET `/api/studio/realisations/pas-un-uuid`.

  L'authentification passe avant la validation.
- **S4-CA44 Les routes existent** : connecté, GET `/api/studio/realisations/<uuid aléatoire>` → 404 `data.code` REALISATION_INTROUVABLE ; `/pas-un-uuid` → 400 VALIDATION.
- **S4-CA45** : POST → 201 ; les clés de `realisation` sont exactement celles de `RealisationStudioDTO`.
- **S4-CA46 Parcours API**
  1. 4 créations avec images ;
  2. `/api/public/<u>/realisations` : `aLaUne` vaut 3, `contenus.realisations` vaut 4 ;
  3. masquer R1 → détail R1 404, `contenus.realisations` vaut 3 ;
  4. réordonner → l'ordre public suit.
- **S4-CA47 U8** : plus aucun fichier `realisations.[` ; plafond d'exceptions 6 (S5, S6) ; les 8 routes S4 sont fines (defineApiHandler, sans drizzle ni db, service + ressource, session d'abord, uuid validé).
- **S4-CA48 Studio, liste** (390 px, seed)
  - h1 « Réalisations », sous-titre « 3 visibles · 2 en vedette sur 3 » ;
  - lignes : miniature, titre, méta « 2025 · CHU de Douala », étiquette « En vedette » ;
  - l'interrupteur grise la ligne et ajoute « · Masqué » ;
  - barre du bas avec « Réalisations » active.
- **S4-CA49 Studio, formulaire**
  - « Enregistrer » sans image principale → message « Ajoutez une image principale. » sous la tuile, **aucune requête**.
  - Galerie :
    - ajouter 2 images, en retirer une, déplacer l'autre avec `ArrowLeft` ;
    - l'ordre enregistré correspond ;
    - à 6 images, la tuile « + » disparaît.
  - Avec 3 vedettes, l'interrupteur « En vedette sur l'accueil » est désactivé et affiche « 3 réalisations sur 3 en vedette. Retirez-en une pour en ajouter une autre. »
  - En création, Année vaut l'année en cours.
- **S4-CA50 Accueil**
  - Section « À la une » (surtitre « Réalisations ») avec **une** réalisation : la 1re vedette, image, titre, description.
  - Lien « Voir toutes les réalisations (3) ».
  - Vitrine sans réalisation visible → pas de section, pas de lien « Réalisations » dans la barre, et `/u/realisations` → page 404.
- **S4-CA51 Détail mobile (390 px)**, ordre des blocs :
  1. « ← Toutes les réalisations », image ;
  2. « RÉALISATION · 2025 », h1 ;
  3. faits (seulement ceux renseignés), description ;
  4. galerie en 2 colonnes, « Voir le projet » (si lien : `target="_blank"`, `rel` contenant `noopener`) ;
  5. « Autres réalisations », bandeau « Un projet en tête ? Parlons-en. » vers `/u/reserver`.

  Sans lien : pas de bouton. Sans autre réalisation : pas de bloc « Autres ».
- **S4-CA52 Navigation** : à 1280 px, « Services » et « Réalisations » sont visibles si leurs compteurs sont > 0. Sur `/u/realisations/x`, le lien « Réalisations » est marqué actif.
- **S4-CA53 Accessibilité**
  - surtitres et liens « Voir toutes… » en `text-accent-texte` ;
  - toutes les images ont un `alt` non vide (galerie : « Image n sur N : {titre} ») ;
  - focus visible sur les vignettes de galerie (public et studio) ;
  - « Voir le projet » annonce « (nouvel onglet) » ;
  - cibles ≥ 44 px.
- **S4-CA54** : le HTML de `GET /studio/realisations/nouveau` ne contient aucun contenu rendu serveur (`ssr:false`).
- **S4-CA55 SEO** :
  - `/u/realisations` → `<title>` « Réalisations — Dr Cabrel Nguesso » ;
  - détail → `<title>` = `seo.titre`, `meta description` = `seo.description`, données structurées présentes.

## 8. Tests

### Unitaires (`tests/unit/`)
- **U18** `schemas-realisation.test.ts` : création (défauts, image requise et son message, strict, galerie max/doublon) ; mise à jour (vide, `imageMediaId:null`) ; réordonnancement ; lien (S4-CA11 et CA12 côté schéma).
- **U19** `realisations-regles.test.ts` : `normalizeRealisationState`, `checkRealisationCoherence`, `mediasARetirer` (échange, retrait, ajout, null).
- **U20** `listes-regles.test.ts` : `resolveEnVedette`, `computeALaUne`, `computeCompteurs`, `slugFromText` (repli et max paramétrés), `pickAvailableSlug(max)`.
- **U21** `realisations-libelles.test.ts` : `normaliserLien`, `metaRealisation`, `metaRealisationStudio`, `surtitreRealisation`, `resumeListeRealisations`, `libelleVedetteRealisations` (0, 1, 2), hrefs.
- **U22** `resource-realisation.test.ts` : liste blanche, SEO (S4-CA39), ordre de la galerie conservé.
- **U8** mis à jour (S4-CA47). **U13, U14, U17 inchangés et verts** : preuve que la factorisation n'a rien changé.

### Intégration (vrais PostgreSQL, Redis et disque ; aucun mock de db, de stockage ni du service)
- `tests/integration/realisations.test.ts` : S4-CA03 à CA42 sauf CA41.
- `tests/integration/migration-0011.test.ts` : S4-CA01 (migrer jusqu'à 0010, insérer, appliquer 0011, vérifier, ROLLBACK, ré-appliquer).
- `tests/integration/vitrines.test.ts` : ajouter S4-CA41 (`getPublicVitrinePage`).
- `tests/integration/medias.test.ts` : ajouter le cas « une image de galerie de réalisation » au tableau de références existant (ligne ~330), plus S4-CA42.
- **Fabriques** :
  - `insertRealisation` **renvoie la ligne** (signature actuelle `Promise<void>`) ; défauts compatibles avec les CHECK ;
  - ajouter `insertRealisationImage(realisationId, mediaId, ordre)`.
- Les tests S2 et S3 existants (vitrines CA compteurs, médias, services) restent verts.

### e2e API
- `e2e/api/realisations.spec.ts` (une session par fichier, `describe.serial`) : S4-CA44, CA45, CA46, plus une vérification HTTP de CA41.
- `studio-auth.spec.ts` : ajouter `ROUTES_S4` (S4-CA43) et retirer `realisations` de `ROUTES_COLLECTIONS`.
- `e2e/api/services.spec.ts` : la constante `MESSAGE_ORDRE_INVALIDE` prend le message générique.

### e2e UI
`e2e/realisations.spec.ts`, rédigé par l'e2e-tester après F : S4-CA48 à CA55 à 390, 768 et 1280 px ; seed `dr-cabrel` ; vitrine fraîche pour l'état vide.

**Gate** : 0 test sauté ; toutes les suites tournent dans le job CI `verification` existant (à vérifier en ouvrant le workflow, pas à supposer).

## 9. Plan frontend

**Injection d'exemples** : lire d'abord `StudioServiceLigne.vue`, `StudioServiceForm.vue`, `StudioServicePhoto.vue`, `useStudioServices.ts`, `useServiceForm.ts`, `ServiceAutres.vue`, `ServicesALaUne.vue`.

**Règles communes**
- `@nuxt/ui` partout, icônes `i-ph-*`, couleurs par variables de palette.
- **Tout texte accent de taille ≤ 18 px en `text-accent-texte`** (surtitres, liens « Voir toutes… », pastilles sur `accent-doux`).
- Typage par `#shared/dto`, erreurs via `lireErreurApi`.
- Libellés et règles depuis `#shared/realisations`.
- Aucun `v-html`.

### F1 : studio

**`/studio/realisations` (`index.vue`) — maquette `Studio · Réalisations`**
- **En-tête** : h1 « Réalisations » ; sous-titre `resumeListeRealisations(...)` ; UButton « Ajouter » vers `/studio/realisations/nouveau`.
- **`StudioRealisationLigne.vue`** (props `{ realisation: RealisationStudioDTO; occupe: boolean }`) :
  - miniature 56 px arrondie : variante 400 de l'image, sinon case en pointillés `border-bordure` (maquette) ;
  - titre sur 2 lignes max ; `metaRealisationStudio` ; UBadge « En vedette » (`bg-accent-doux text-accent-texte`) ;
  - USwitch, `aria-label="Visible sur la vitrine : {titre}"`, hors du lien ;
  - ligne entière en NuxtLink vers `/studio/realisations/{id}` ;
  - masquée = opacité réduite ;
  - poignée `i-ph-dots-six-vertical` avec flèches haut/bas (écart #61, comme S3).
- **Texte d'aide** (maquette) : « Les réalisations en vedette s'affichent en premier sur l'accueil. Les autres restent sur la page Réalisations. »
- **États** :
  - chargement : USkeleton ×4 ;
  - sans vitrine : UEmpty vers `/onboarding` ;
  - erreur : « Réessayer » ;
  - vide : `StudioVide`, icône `i-ph-squares-four`, « Montrez votre travail », « Ajoutez une première réalisation : vos visiteurs verront concrètement ce que vous faites. », bouton « Ajouter une réalisation ».
- Un seul message à la fois, `role="alert"` ; annonce `aria-live` pour l'ordre.

**`useStudioRealisations.ts`**
- Miroir de `useStudioServices.ts` : clé `studio-realisations`, `TOUJOURS_FRAIS`, `basculerVisibilite` optimiste (masquer retire la vedette), `reordonner` sérialisé, `deplacer` au clavier, `useSortable` sur la poignée.
- Duplication assumée, factorisation à S5 (3e usage, dette notée).
- Plus `useStudioRealisation(id)` (miroir de `useStudioService`, `introuvable` sur REALISATION_INTROUVABLE ou 400).

**`/studio/realisations/nouveau` et `/studio/realisations/[id]` — maquette `Studio · Nouvelle réalisation`**
- `[slug].vue` est supprimé. Les deux pages rendent `StudioRealisationForm.vue` (props `{ realisation: RealisationStudioDTO | null; compteurs: RealisationsCompteursDTO }`).
- **Ordre des champs**
  1. StudioRetour « Réalisations ».
  2. h1 « Nouvelle réalisation » ou « Modifier la réalisation ».
  3. **Image principale** (`StudioRealisationImage.vue`) :
     - tuile pleine largeur `aspect-[2/1]`, pointillés `border-accent`, fond `bg-accent-doux`, icône + « Ajouter une image » (`text-accent-texte`) ;
     - avec image : aperçu `object-cover` + bouton « Changer l'image » ; **pas** de « Retirer » (obligatoire) ;
     - erreur sous la tuile (`role="alert"`) ;
     - utilise `useMediaUpload` ; `aria-describedby` vers l'erreur.
  4. **Galerie · facultative** (`StudioRealisationGalerie.vue`, props `{ images: MediaDTO[] }`, emit `update:images`) :
     - vignettes 96 px (`bg-accent-doux`, image 400) ;
     - chaque vignette est un `button` focalisable ; `ArrowLeft`/`ArrowRight` la déplacent (annonce « Image 2 sur 4 ») ; glisser via `useSortable` ;
     - bouton de retrait `i-ph-x` superposé, `aria-label="Retirer l'image {n} de la galerie"`, ≥ 44 px de cible effective ;
     - tuile « + » en pointillés (`aria-label="Ajouter des images à la galerie"`), `input multiple` ;
     - envoi séquentiel jusqu'à atteindre 6 ; au-delà : « La galerie compte 6 images au maximum. » ;
     - tuile masquée à 6 ; aide « {n} sur 6 ».
  5. Titre (UInput, requis, max 100, indication #65).
  6. Description (UTextarea, aide « Racontez le contexte, votre rôle et le résultat. »).
  7. Année | Lieu ou client : 2 colonnes à partir de 390 px (comme la maquette). Année = UInput `inputmode="numeric"`, convertie en entier ou `null` ; création pré-remplie avec `anneeCourante()`.
  8. Votre rôle (UInput).
  9. Lien externe (UInput `type="url"`, indication « https:// »).
  10. USwitch « Visible sur la vitrine » / « Désactivez pour masquer cette réalisation sans la supprimer. »
  11. USwitch « En vedette sur l'accueil » / `libelleVedetteRealisations(n, max)` + « Retirez-en une pour en ajouter une autre. » si complet ; désactivé si complet et pas déjà en vedette, ou si masquée.
  12. UButton « Enregistrer » (bloc, `loading`).
  13. En modification : « Supprimer cette réalisation » → UModal « Supprimer « {titre} » ? Elle disparaîtra de votre vitrine, avec ses images. Cette action est définitive. » (Supprimer en couleur error / Annuler).
- **`useRealisationForm.ts`**
  - État depuis le DTO (`galerie` = `MediaDTO[]` locale, envoyée en ids).
  - Envoi : POST = tout ; PUT = champs modifiés seulement ; `galerie` envoyée seulement si la liste ou son ordre a changé.
  - Contrôle client avant envoi : image principale requise, rien d'autre (le serveur fait foi).
  - Erreurs : 400 `champs` rangées par champ ; VEDETTE_COMPLETE → message sous l'interrupteur avec les titres de `data.enVedette` ; MEDIA_INVALIDE sous l'image ; REALISATION_INTROUVABLE → UEmpty « Cette réalisation n'existe plus ».
  - Succès : `refreshNuxtData('studio-realisations')` et `refreshNuxtData('studio-vitrine')`, puis `navigateTo('/studio/realisations')`.
- **`useStudioNav.ts`** : ajouter `'/studio/realisations/'` à `PREFIXES_ENFANTS` (barre du bas masquée sur le formulaire, entrée Réalisations active).

### F2 : public

**Navigation et cadre (#56)**
- **`usePublicVitrine.ts`** :
  - type du fetch : `VitrinePubliqueReponse` ; retour **inchangé** (`Ref<VitrinePubliqueDTO>`) ;
  - ajouter `usePublicContenus(username): ComputedRef<ContenusPublicsDTO>`, qui lit `useNuxtData('vitrine-publique-'+username)` sans nouvelle requête ; repli `{services:0, realisations:0}`.
- **`VitrineCadre`** : props `{ vitrine; barreBasse? }` (**`servicesTotal` supprimé**) ; `const contenus = usePublicContenus(vitrine.username)` ; passe `contenus` à la Nav.
- **`VitrineNav`** :
  - props `{ nomAffiche; username; contenus: ContenusPublicsDTO }` ;
  - à partir de `md` : « Services » (si > 0), « Réalisations » (si > 0), « Contact » ;
  - lien actif = la route commence par `/{username}/realisations` (ou `/services`) : `text-encre` + `aria-current="page"` ; les autres en `text-texte-secondaire` (contraste OK).
- **Pages S3** : `[username]/index.vue`, `services/index.vue`, `services/[slug].vue`, `reserver.vue` retirent `:services-total`. `reserver.vue` n'appelle plus `usePublicServices`, qui ne lui servait qu'au total.

**Composables**
- `usePublicRealisations(username)` : `useAsyncData('realisations-publiques-'+u)`, ne lève jamais.
- `usePublicRealisation(username, slug)` : 404 → `erreurPagePublique`, fatal.

**Composants `app/components/realisation/`**
- **`RealisationVisuel.vue`** (props `{ image: MediaDTO|null; titre: string; format: 'carte'|'detail'|'miniature' }`) :
  - `img` avec `srcset`/`sizes`, `object-cover` ;
  - formats : carte `aspect-[4/3]`, détail `aspect-[16/10]` (bord à bord sur mobile, arrondi à partir de `lg`), miniature `size-16` arrondie ;
  - `alt` « Image de la réalisation {titre} » ;
  - repli : `bg-accent-doux` + `i-ph-image` en `text-accent`, `aria-hidden` (comme les tuiles de maquette).
- **`RealisationCarte.vue`** (page liste) :
  - visuel ;
  - `metaRealisation` (`text-accent-texte`, petites capitales) ;
  - h2 serif ;
  - description `line-clamp-2` ;
  - carte entière cliquable par un lien étiré (un seul `a`, titre comme texte du lien).
- **`RealisationFaits.vue`** : `dl` en lignes séparées par `border-bordure`, `dt` en `text-texte-secondaire`, `dd` en `text-encre` semibold aligné à droite ; une ligne seulement par fait présent ; rien si aucun.
- **`RealisationGalerie.vue`** :
  - `ul` en `grid-cols-2 lg:grid-cols-3 gap-3` ; vignettes carrées arrondies ;
  - chaque vignette est un `a :href="image.url"` (`aria-label="Agrandir l'image n sur N"`), `img` 800, `loading="lazy"` ;
  - masqué si la galerie est vide.
- **`RealisationAutres.vue`** : h2 « Autres réalisations » ; lignes (miniature, titre serif, méta, `i-ph-caret-right`) ; lien « Voir toutes les réalisations ({total}) » en `text-accent-texte`. Masqué si `autres` est vide.
- **`RealisationAppel.vue`** : `section` `bg-accent-doux` arrondie ; h2 « Un projet en tête ? Parlons-en. » ; p « Prenez rendez-vous pour en discuter. » ; UButton bloc « Prendre rendez-vous » vers `/{username}/reserver`.

**Accueil `/[username]` — maquettes `Vitrine · Terracotta` / `Tablette` / `PC`**
- Nouveau **`components/vitrine/ALaUne.vue`** (props `{ username; realisation: RealisationPublicCarteDTO | null; realisationsTotal: number }`).
- **Conçu pour accueillir le témoignage en S5** : grille `md:grid-cols-2`, colonne droite réservée par un slot `temoignage`.
- Surtitre : « Réalisations » en S4 (S5 : « Réalisations · Témoignages » si les deux) ; h2 « À la une ».
- Carte : visuel `aspect-[16/10]` arrondi, h3 serif en lien vers le détail, description `line-clamp-3`, lien « Voir toutes les réalisations ({n}) ».
- Seule (S4) : sur `md+`, la carte passe en disposition horizontale (image à gauche, texte à droite) pour ne pas laisser une colonne vide.
- Rendue seulement si `realisation !== null`.
- Placée **après** `VitrineServicesALaUne` (l'agenda S7 s'insérera entre les deux, comme la maquette).
- `index.vue` ajoute `usePublicRealisations` au `Promise.all` et passe `aLaUne[0]`.

**`/[username]/realisations` (sans maquette, dérivée de `Page Services · PC`)**
- UBreadcrumb « Accueil / Réalisations » ; h1 « Mes réalisations » ; intro « Quelques projets qui montrent ma façon de travailler. »
- Grille de `RealisationCarte` en 1, 2 puis 3 colonnes.
- `total === 0` → 404.
- SEO : titre `Réalisations — {nomAffiche}`, description `Les réalisations de {nomAffiche}, {metier} à {ville}.`

**`/[username]/realisations/[slug]` — maquette `Réalisation · Mobile`, PC dérivé de `Service · PC`**
- **Mobile**, dans l'ordre :
  1. « ← Toutes les réalisations » ;
  2. `RealisationVisuel` détail bord à bord ;
  3. surtitre `surtitreRealisation` (`text-accent-texte`, majuscules espacées) ;
  4. h1 serif ;
  5. `RealisationFaits` ;
  6. description (`whitespace-pre-line`) ;
  7. `RealisationGalerie` ;
  8. UButton outline bloc « Voir le projet » (si lien), `target="_blank" rel="noopener noreferrer"`, icône `i-ph-arrow-square-out` + `sr-only` « (nouvel onglet) » ;
  9. `RealisationAutres` ;
  10. `RealisationAppel`.
- **PC (`lg`)** : 2 colonnes `[minmax(0,1fr)_22rem]`.
  - Gauche : visuel, surtitre, h1, description, galerie.
  - Droite : carte collante `bg-surface` avec `RealisationFaits` et « Voir le projet ».
  - Puis pleine largeur : `RealisationAutres` et `RealisationAppel`.
- **SEO** :
  - `useSeoMeta` depuis `realisation.seo` (+ `ogImage` = URL 1600 si l'URL absolue du site est disponible ; sinon reporté en S12) ;
  - données structurées `CreativeWork` (name, description, `dateCreated` = année, creator Person `nomAffiche`, image) via `useSchemaOrg`.
  - Vérifier qu'un nœud brut est accepté ; sinon `useHead` avec `script type="application/ld+json"` (JSON sérialisé, `<` échappé). Le signaler.

### Écarts maquette assumés
- Poignée de réordonnancement dans la liste studio.
- Indications neutres dans le formulaire.
- Pas de « Retirer l'image principale ».
- Libellé public « Rôle ».
- Bouton du haut « Me contacter » (S7).
- Page liste et détail PC sans maquette.
- Galerie publique cliquable.
- Carte « À la une » horizontale tant que le témoignage n'existe pas (S5).

## 10. Plan de tâches (périmètres de fichiers disjoints)

| # | Agent | Tâche | Fichiers exclusifs | Dépend de | Taille |
|---|---|---|---|---|---|
| L1a | backend | Contrats §4 | `shared/listes.ts`, `shared/realisations.ts`, `shared/schemas/aides.ts`, `shared/schemas/realisation.ts`, `shared/dto/realisation.ts`, `shared/dto/vitrine.ts`, `shared/dto/index.ts`, `shared/erreurs.ts`, `shared/services.ts` (1 ligne), `server/exceptions/http.ts` | — | M |
| L1b | database | schema.ts, migration 0011 + snapshot + journal, seed ; test up → down → up | `shared/db/schema.ts`, `server/db/migrations/**`, `server/db/seed.ts` | — (parallèle à L1a ; le seed importe `GALERIE_MAX` après L1a) | M |
| L2 | tester (RED) | §8 unitaires, intégration, e2e API, U8, studio-auth, fabriques, constante services.spec | `tests/**`, `e2e/api/**` | L1a, L1b | L |
| L3a | backend (GREEN) | Factorisations : `listes-regles.ts`, `vitrine-acces.ts`, `resources/seo.ts` ; délégation dans `services-regles.ts` et `resources/service.ts` | ces 5 fichiers | L2 | S |
| L3b | backend (GREEN, 3 cycles max) | `realisations-regles.ts`, `realisations.ts`, `resources/realisation.ts`, 8 routes, suppression des 5 anciennes ; `medias.ts`, `vitrines.ts`, `resources/vitrine.ts`, `public/[username]/index.get.ts` | `server/**` sauf `server/db/**`, `server/exceptions/http.ts`, les fichiers de L3a et `server/services/services.ts` | L3a | L |
| L3c | backend | `services.ts` passe à `vitrine-acces.ts` (suppression des copies privées) ; suites S3 vertes | `server/services/services.ts` | L3b | S |
| F1 | frontend | §9 F1 ; supprimer `studio/realisations/[slug].vue` | `app/pages/studio/realisations/**`, `app/components/StudioRealisation*.vue`, `app/composables/useStudioRealisations.ts`, `app/composables/useRealisationForm.ts`, `app/composables/useStudioNav.ts` | L1a | L |
| F2 | frontend | §9 F2 | `app/pages/[username]/**` (index, services/index, services/[slug], reserver, realisations/**), `app/components/realisation/**`, `app/components/vitrine/{Cadre,Nav,ALaUne}.vue`, `app/composables/usePublicVitrine.ts`, `app/composables/usePublicRealisations.ts`, `app/composables/usePublicRealisation.ts` | L1a | L |
| L4 | e2e-tester | e2e UI S4-CA48 à CA55 | `e2e/realisations.spec.ts` | L3c, F1, F2 | M |
| L5 | reviewer + regression-checker + ux-reviewer | Lecture seule (voir consommateurs ci-dessous) | — | L4 | M |
| L6 | thread principal | `PROJECT_STATE.md`, `docs/JOURNAL_DECISIONS.md` (#46 à #67, écarts). CLAUDE.md §8 inchangé : aucune nouvelle bibliothèque | 2 fichiers | L5 | S |

**Consommateurs à vérifier en L5**
- `studio/index.vue` (compteurs, prochaine étape `/studio/realisations/nouveau`) ;
- `vitrines.ts` `summarize` ; `medias.ts` ;
- tests S2 et S3 utilisant `insertRealisation` ;
- `@[username].vue` (type de `usePublicVitrine`) ;
- pages S5 `[username]/temoignages/*` toujours montées, appelant des API absentes (connu, S5) ;
- contraste des liens accent de S3.

**Parallélisme possible** : L1a ∥ L1b, puis L2 ∥ F1 ∥ F2, puis L3a → L3b → L3c.

**Fin de lot** : `pnpm lint`, `pnpm typecheck`, `pnpm test` (0 test sauté), `pnpm e2e`, `pnpm build` verts, sortie brute collée. Nombre de fichiers prévus = nombre traités : **environ 87**, dont 6 suppressions :

| Lot | Fichiers |
|---|---|
| L1a | 10 |
| L1b | 5 |
| L2 | 14 |
| L3 | 26 (dont 5 suppressions) |
| F1 | 11 (dont 1 suppression) |
| F2 | 18 |
| L4 | 1 |
| L6 | 2 |

## 11. Points d'attention

**Sécurité**
- Isolation : toute requête studio est filtrée par la vitrine de `session.user.id` ; l'id d'autrui donne 404, jamais 403.
- Propriété de chaque média (principal + galerie) vérifiée sous verrou.
- Lien : http(s) seulement, en Zod **et** en CHECK ; `rel="noopener noreferrer"`. Le DTO ne garantit rien de plus : le composant n'affiche le lien que tel quel dans un `href`, jamais interprété.
- DTO publics en liste blanche ; description en texte.

**Concurrence** : verrou `FOR UPDATE` sur la vitrine pour création, mise à jour, galerie, suppression et ordre. Plafond de galerie et unicité garantis en base.

**Performance**
- Une requête par liste plus une pour toutes les galeries, pas de N+1.
- `contenus` : une requête de deux sous-comptes par page publique, qui s'appuie sur l'index `(vitrine_id, slug)`. À surveiller sous charge ; cache par page en S12.
- Galerie publique en variante 800 `lazy`.

**Médias orphelins** (dette)
- Images téléversées puis abandonnées. La limite d'envoi est de 30 par heure (une réalisation complète en consomme 7).
- Proposition S13 : job BullMQ qui supprime les `medias` non référencés de plus de 24 h. Sa liste de références doit inclure `realisation_images`.

**Dépendances futures**
- S5 :
  - le témoignage s'insère dans `VitrineALaUne` (slot droit, surtitre « Réalisations · Témoignages ») ;
  - `useStudioRealisations` et `useStudioServices` sont à factoriser au 3e usage ;
  - les témoignages réutilisent `listes-regles.ts`, `vitrine-acces.ts`, les codes génériques.
- S10 : `PlanService` branché dans `createRealisation` (refus au-delà de la limite), dans `getPublicRealisations` et dans `contenus` (masquer les plus récentes au-delà de la limite). Ce sont les trois seuls points d'insertion.
- S12 : sitemap des réalisations, image de partage, cache.

**Données de développement** : les normalisations de 0011 sont irréversibles (ROLLBACK seulement structurel). C'est accepté, comme 0010.

**Hors périmètre** :
- témoignages, catégories, tags, vidéo ;
- légende ou texte alternatif par image ;
- visionneuse de galerie ;
- recadrage d'image ;
- édition du slug ;
- limites du plan ;
- `nofollow`/`ugc` sur les liens externes (idée S12).

## Décisions produit ambiguës à faire trancher par Cabrel (défaut proposé)

1. **Une seule réalisation à la une sur l'accueil (maquette), mais 3 vedettes possibles** (#51). Défaut : l'accueil montre la 1re vedette ; les 2 autres n'ont pas d'effet visible.
   - Alternative A, recommandée par l'architect : réduire la vedette des réalisations à **une seule** (« À la une »), plus claire pour l'utilisateur.
   - Alternative B : afficher les 3 sur l'accueil (maquette à refaire).
2. **Image principale obligatoire** (#47), alors que la liste de la maquette montre des réalisations sans image. Alternative : facultative comme pour les services, avec repli visuel.
3. **Galerie de 6 images max** (#46, ⚠️ dans SPRINTS).
4. **Libellé public « Rôle »** au lieu de « Votre rôle » (#55).
5. **Année pré-remplie avec l'année en cours** à la création (#54). Alternative : champ vide.
6. **Galerie publique cliquable vers l'image 1600, sans visionneuse** (#60).
7. **Seed** (#64) : rôles NULL faute de données ; descriptions des réalisations 2 et 3 à fournir ; aucune URL de projet.
8. **Messages d'erreur génériques** `VEDETTE_COMPLETE`/`ORDRE_INVALIDE` partagés par toutes les listes (#57).
9. **Indications de formulaire neutres** au lieu des exemples cardiologiques de la maquette (#65).
10. **Bandeau « Un projet en tête ? »** vers la page provisoire `/reserver` jusqu'à S7 (#59).

## Fichiers clés (absolus)
- /home/cabrel/projects/brandself-app/brandself-app/shared/db/schema.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/db/migrations/0004_realisations.sql
- /home/cabrel/projects/brandself-app/brandself-app/server/db/migrations/0010_s3_services.sql (patron de migration)
- /home/cabrel/projects/brandself-app/brandself-app/server/db/migrations/meta/_journal.json
- /home/cabrel/projects/brandself-app/brandself-app/server/db/seed.ts
- /home/cabrel/projects/brandself-app/brandself-app/shared/schemas/realisation.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/api/studio/realisations.[slug].put.ts (et les 4 autres `realisations.*`)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/services.ts, /home/cabrel/projects/brandself-app/brandself-app/server/services/services-regles.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/services/medias.ts (`deleteMediaIfUnreferenced` à étendre : risque de suppression silencieuse d'images de galerie)
- /home/cabrel/projects/brandself-app/brandself-app/server/services/vitrines.ts, /home/cabrel/projects/brandself-app/brandself-app/server/api/public/[username]/index.get.ts
- /home/cabrel/projects/brandself-app/brandself-app/server/exceptions/http.ts, /home/cabrel/projects/brandself-app/brandself-app/shared/erreurs.ts
- /home/cabrel/projects/brandself-app/brandself-app/app/components/vitrine/Cadre.vue, /home/cabrel/projects/brandself-app/brandself-app/app/components/vitrine/Nav.vue
- /home/cabrel/projects/brandself-app/brandself-app/app/composables/usePublicVitrine.ts, /home/cabrel/projects/brandself-app/brandself-app/app/composables/useStudioNav.ts
- /home/cabrel/projects/brandself-app/brandself-app/tests/unit/routes-convention.test.ts
- /home/cabrel/projects/brandself-app/brandself-app/tests/integration/support/fabriques.ts
- /home/cabrel/projects/brandself-app/brandself-app/e2e/api/studio-auth.spec.ts, /home/cabrel/projects/brandself-app/brandself-app/e2e/api/services.spec.ts (ligne 26)
- Maquettes : /home/cabrel/projects/brandself-app/brandself-app/docs/maquettes/Studio · Réalisations@2x.png, Studio · Nouvelle réalisation@2x.png, Réalisation · Mobile@2x.png, Vitrine · Terracotta@2x.png, Vitrine · PC@2x.png, Vitrine · Tablette@2x.png