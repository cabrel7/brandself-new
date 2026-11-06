# Spec S11 : statistiques de la vitrine

Branche `sprint/s11-statistiques`. **Tier standard pour l'effort, tier critique pour la sécurité** : la collecte touche des données personnelles pseudonymisées des visiteurs (empreinte d'adresse IP) — revue sécurité obligatoire, comme S9 l'a été. Les décisions reprennent à **#167**.

> **Écart au brief (numérotation)** : le brief prévoyait « décisions #135+ ». La spec `docs/specs/S12-seo-performance.md`, déjà présente sur `sprint/s12-seo` (et exécutée en premier : « S12 passe avant S11 »), occupe **#135 à #166**. S11 prend donc **#167 à #190** pour éviter toute collision au merge et dans `docs/JOURNAL_DECISIONS.md`.

## Sources lues

- **Documents** : CLAUDE.md, PROJECT_STATE.md (dette 6, décision plan #8), SPRINTS.md §S11 (l. 379-389), docs/specs/S9-notifications.md (format de spec repris, §4 jobs, §7 frontend, §8 CA), docs/specs/S10-abonnements.md (en-tête, §1 décisions, §6 CA, §13 questions), `docs/specs/S12-seo-performance.md` lu via `git show sprint/s12-seo:…` (contrat §CHALLENGE point 9 : « l'envoi d'une vue doit rester un POST côté navigateur, hors HTML » — le microcache de 10 s ne doit jamais compter une vue), maquette `docs/maquettes/Studio@2x.png` (carte « Statistiques des 7 derniers jours », ligne 128 visites / 14 clics / 3 réservations), PROJECT_CONTEXT.md §8 (plans : `statistiquesJours` déjà présent) et règle de bibliothèque (§254).
- **Skills** : `~/.claude/skills/nitro/SKILL.md` et `~/.claude/skills/ui-ux/SKILL.md` (lus avant rédaction).
- **Code (existant, inchangé sauf mention)** : `shared/db/schema.ts` (aucune table de statistiques), `shared/jobs.ts`, `shared/limites.ts`, `shared/erreurs.ts`, `shared/dto/vitrine.ts` (`statistiques7j` en littéraux `0`), `shared/listes.ts` (`LISTE_SLUG_MAX`, `LISTE_SLUG_REGEX`), `server/config/plans.ts` (`statistiquesJours` 7/90), `server/services/plans.ts` (`getPlanEffectif`), `server/services/vitrines.ts` (`summarize`, `getPublicVitrine`), `server/services/liens.ts` (`recordLienClic`), `server/services/limiteur.ts` (`enforceLimit`, fail-open), `server/services/notifications/activite.ts` (`compterActivite` : tous statuts), `server/services/email-outbox.ts` (`prepareResumeHebdo`, `visites: null, clics: null` l. 645-646), `server/services/emails/notifications-contenus.ts` (`CompteursResume`, `lignesCompteurs`), `server/utils/{api,validation,client-ip}.ts`, `server/exceptions/http.ts`, `server/resources/vitrine.ts` (l. 49), `server/jobs/{queues,notifications}.ts` (`upsertJobScheduler`), `worker/index.ts` (worker `maintenance`), `server/api/public/[username]/liens/[slug]/clic.post.ts` (modèle de route publique), `server/api/studio/vitrine/index.get.ts` (modèle de route studio), `tests/support/h3.ts` (faux événements réels), `e2e/helpers/session.ts` (`db()`, `lireEnv`), `app/pages/studio/index.vue` (carte statistiques l. 73-79, 154-160), `app/components/tarifs/Selecteur.vue` (`URadioGroup` segmenté réutilisable), `app/composables/useApiErreur.ts`, `server/db/seed.ts`.
- **Bibliothèques évaluées (npm)** : `isbot@5.2.2` (types embarqués), `ua-parser-js@2.0.10` (types embarqués). Aucune des deux n'est déjà dans `package.json`.
- **Non lu, à vérifier par les lots** : `server/db/migrations/` détail des dernières migrations (le lot backend génère via `pnpm db:generate` et renomme), `docs/maquettes/Studio-2x` alternatives si d'autres exports existent.

---

## CHALLENGE

**Hypothèses implicites du brief**
- **« Statistiques » = visites de pages publiques.** Aucun événement métier (clic sur « Appeler », envoi de WhatsApp, téléchargement) n'est compté comme visite ; le seul autre compteur est le clic sur un lien de la page Liens, déjà existant.
- **« 90 jours de rétention brute » suffisent au plan payant** : la période la plus longue (90 j) ne dépassera jamais la rétention des lignes brutes, donc les agrégats ne servent qu'à la lecture, pas à l'historique au-delà de la période.
- **Les chiffres du jour doivent être visibles immédiatement** alors que l'agrégation est quotidienne : un professionnel qui reçoit 3 visiteurs à 14 h doit les voir à 14 h, pas le lendemain.
- **Les réservations sont comptées « telles quelles »** : le brief renvoie vers la spec pour le statut.

**Angles morts**
1. **Fuseau : le job à 11:00 UTC ne couvre pas tout.** À cette heure, il est 01:00 (UTC+14) ou 23:00 (UTC-12) selon le fuseau : la « veille locale » n'est pas partout terminée ni partout agrégée. Un job unique à une heure fixe laisse la veille partiellement agrégée pendant des heures (jusqu'à 11 h en Amérique).
2. **Le résumé du lundi 8 h locale est préparé avant le job de 11 h UTC** pour les fuseaux avancés (UTC+14 : le lundi 8 h locale = dimanche 18 h UTC). Lire uniquement les agrégats y perdrait le dernier jour.
3. **Statut des réservations mutable** : exclure « annulée » au moment de la lecture ferait dériver l'historique (une réservation annulée un mois plus tard effacerait une visite du comptage).
4. **Cardinalité des pages et sources non bornée** : un tiers peut envoyer `POST /vue` avec n'importe quel chemin ou un `Referer` de spam → tables qui grossissent à l'infini.
5. **`statistiques7j` est typé en littéraux `0`** (`shared/dto/vitrine.ts`) : passer à de vrais nombres casse silencieusement le typage tant que le DTO n'est pas changé — à faire dans le même commit.
6. **IP absente** (`getClientIp` → `'inconnue'`) : clé de limiteur et empreinte doivent tolérer cette valeur sans planter ni créer un trou dans le comptage.
7. **Le contrat S12** : le microcache nginx de 10 s compterait les vues au rendu si l'envoi n'était pas un POST navigateur distinct — d'où l'interdiction d'envoyer la vue depuis le HTML ou le SSR.
8. **`e2e/api/parcours-vitrine.spec.ts` asserte `statistiques7j: 0/0/0`** sur une vitrine fraîche : hypothèse encore vraie (aucune navigation publique dans ce test), à revérifier en fin de sprint.

**Meilleure approche (retenue)**
1. **Lecture hybride** : jours `aujourd'hui` et `hier` (locaux) lus en direct sur `vues` (visites, uniques, pages, sources) ; clics toujours dans `statistiques_jour` (incrémentés à l'écriture du clic) ; jours ≥ 2 lus dans les agrégats. Le timing du job n'apparaît jamais dans l'interface.
2. **Agrégats typés en 3 tables** (`statistiques_jour`, `…_pages`, `…_sources`) avec clés primaires naturelles : lecture indexée, zéro JSON, cardinalité bornée par construction (types de page en liste fermée, slug vérifié en base, sources en liste fermée).
3. **Empreinte = HMAC journalier par vitrine** (HKDF du secret d'authentification, information dédiée, message `jour|vitrineId|ip`) : jamais d'IP en base (le CHECK hex64 l'interdit textuellement), ré-identification impossible d'un jour à l'autre ni d'une vitrine à l'autre, aucun cookie.
4. **Normalisation de page en deux temps** : fonction pure (chemin → type + identifiant) puis vérification d'existence du slug en base pour service/réalisation, sinon repli `autre` → la table pages ne contient jamais de slug inventé.
5. **Tout ce qui touche au plan passe par `PLANS[plan]`** (`statistiquesJours`, nouveau `statistiquesDetails`) : aucune période, aucun détail écrit en dur dans une route.

**À retirer / simplifier**
- Pas de graphique, pas d'export CSV, pas de page publique de statistiques, pas de funnel, pas de géoloc IP, pas de cookie, pas de table d'événements pour les clics (un incrément SQL suffit).
- Pas de clamp silencieux de période (une période hors plan est une erreur explicite 403, comme les quotas S10).
- Pas d'agrégat pour appareil et pays en S11 (collectés, jamais affichés : agréger une dimension morte serait du code mort).

**Périmètre réel vs demandé** — le brief oublie trois branchements que le code exige : (1) la ligne de chiffres de l'accueil studio, annoncée au point 3 du brief mais détaillée nulle part (`summarize` + resource) ; (2) le résumé hebdomadaire S9 qui affiche `visites: null, clics: null` et attend S11 ; (3) les chiffres de démonstration du seed. Les trois sont dans le périmètre ci-dessous.

---

## 0. État des lieux

- **Aucune table** de statistiques, aucun job, aucune route `statistiques`, aucun plugin de suivi (`app/plugins/` n'existe pas encore).
- **Ligne de chiffres** : `StudioResumeDTO.statistiques7j = { visites: 0, clics: 0, reservations: 0 }` codé en dur dans `server/resources/vitrine.ts:49` ; `summarize()` (`server/services/vitrines.ts:222`) ne calcule que les compteurs de contenus. Dette `PROJECT_STATE.md` n° 6 : « affichage trompeur ».
- **Résumé hebdomadaire S9** : `prepareResumeHebdo` force `visites: null, clics: null` ; `lignesCompteurs` omet les lignes sur `null` (contrat `CompteursResume` déjà `number | null`).
- **Périodes** : `ConfigPlan.statistiquesJours` existe déjà (gratuit 7, payant 90) ; `getPlanEffectif(userId, now)` donne le plan effectif (grâce S10 incluse).
- **Réutilisables tels quels** : `enforceLimit` (limiteur Redis fail-open), `getClientIp`, `getPublicVitrine` (404 hors vitrine publiée), `readParamsWith`/`readBodyWith`, `defineApiHandler`, `upsertJobScheduler` + file `maintenance`, `TarifsSelecteur` (URadioGroup segmenté), `useApiErreur` (affichage des codes d'erreur).
- **Maquette** : la carte « Statistiques des 7 derniers jours » (trois chiffres) existe déjà dans `app/pages/studio/index.vue` ; S11 la rend réelle et lui ajoute un bouton de détail.

---

## 1. Décisions par défaut (#167 à #190)

| N | Sujet | Décision |
|---|---|---|
| 167 | Empreinte visiteur | **HMAC-SHA256 journalier par vitrine**. Clé = `hkdfSync('sha256', env.NUXT_BETTER_AUTH_SECRET, Buffer.alloc(0), 'brandself-statistiques-visite-v1', 32)` (même motif que `TELEPHONE_EMPREINTE_HKDF_INFO`). Message = `${jourIso}|${vitrineId}|${ip}` → hexadécimal 64. **Jamais d'IP, jamais de clé en base** ; le CHECK `empreinte ~ '^[a-f0-9]{64}$'` rend une IP brute stockée textuellement impossible (un IPv4 contient des points, un IPv6 des deux-points). Aucun cookie, aucun fingerprint navigateur (UA et pays sont des métadonnées de requête, pas un identifiant). Le sel « change chaque jour » est obtenu naturellement : le jour fait partie du message HMAC. |
| 168 | Jour civil local | Colonne `jour date` = **jour dans le fuseau de la vitrine** (`vitrines.fuseau`, défaut `Africa/Douala`), calculée avec `@js-temporal/polyfill` à l'écriture. Toutes les fenêtres (périodes, jobs, purge) sont exprimées en jours locaux de la vitrine. |
| 169 | Modèle : 4 tables | `vues` (brut, rétention 90 j) + `statistiques_jour` (totaux) + `statistiques_jour_pages` + `statistiques_jour_sources`. Agrégats typés, clés primaires naturelles, **zéro JSON** (règle 3), aucune colonne chemin d'image ni métadonnée libre. |
| 170 | Lecture hybride | Jours `jour >= aujourd'hui_local - 1` : visites, visiteurs uniques, pages et sources lus **en direct sur `vues`** (agrégat `GROUP BY`) ; clics toujours lus dans `statistiques_jour` (incrémentés en temps réel). Jours plus anciens : les 3 tables d'agrégats. Justification : le job de 11 h UTC laisse la veille partiellement agrégée jusqu'à midi UTC (angle mort 1), et le résumé du lundi part avant le job (angle mort 2). Un agrégat partiellement écrit pour « aujourd'hui » n'est jamais lu et est réécrit complet à la fenêtre suivante. |
| 171 | Clics | `statistiques_jour.clics` est **incrémenté atomiquement au moment du clic**, dans `recordLienClic` : `INSERT … ON CONFLICT (vitrine_id, jour) DO UPDATE SET clics = statistiques_jour.clics + 1`, dans la même transaction que la mise à jour de `liens`. **L'agrégation n'écrit jamais `clics`** (l'`ON CONFLICT DO UPDATE` ne touche que `visites`, `visiteurs_uniques`, `updated_at`). `liens.clics` (lifetime) reste inchangé. |
| 172 | Réservations | Comptées depuis `reservations` sur `created_at`, **tous statuts** (`en_attente`, `confirmee`, `annulee`, `terminee`, `refusee`), créées dans la fenêtre. Justification : cohérence exacte avec `compterActivite` (S9) — le même événement ne se compte pas différemment dans deux e-mails/compteurs — et l'historique ne dérive pas quand le statut change après coup. Les annulations se reflètent dans le futur, jamais dans le passé. |
| 173 | Job d'agrégation | `JOBS.agregerStatistiques = 'statistiques-agreger'`, **file `maintenance`**, cron `0 11 * * *` **UTC** (`tz: 'UTC'`, `upsertJobScheduler` idempotent, `attempts: 1`, modèle S9). Cible : toutes les lignes `vues` avec `jour >= (date UTC du jour) - 4` (`AGGREGATION_FENETRE_JOURS = 4` : couvre UTC±14 et 2 jours de panne du worker), regroupement `GROUP BY vitrine_id, jour`, écriture des 3 agrégats. Idempotent : re-exécution = mêmes valeurs. |
| 174 | Purge | `JOBS.purgerStatistiques = 'statistiques-purger'`, file `maintenance`, cron `0 5 * * *` UTC : supprime `vues` avec `jour < (date UTC - 90)` (`VUES_RETENTION_JOURS = 90`) et agrégats avec `jour < (date UTC - 180)` (`STATISTIQUES_RETENTION_JOURS = 180`). Bornes en jours UTC : écart d'au plus 1 jour civil local, sans effet fonctionnel (la période max est de 90 jours) — assumé. Idempotente. |
| 175 | Périodes et plan | Liste autorisée `PERIODES_STATISTIQUES = [7, 30, 90]`. Période acceptée si `periode <= PLANS[plan].statistiquesJours` (7 pour gratuit, 90 pour payant — **la config, jamais le composant**). **Période hors plan → 403 `STATISTIQUES_PERIODE_INTERDITE`** avec `data: { periode, joursMax }` (pas de clamp silencieux : le 7 silencieux sur un 30 demandé mentirait sur la période affichée). Toute valeur hors `{7,30,90}` → 400 `VALIDATION` (Zod enum). |
| 176 | Détails selon plan | Gratuit : totaux + répartition par jour, `pages: null`, `sources: null`. Payant : + top 10 pages + sources. Décidé par le nouveau `ConfigPlan.statistiquesDetails: boolean` (gratuit `false`, payant `true`) — pas de test de plan dans une route. |
| 177 | Collecte appareil/pays | Stockés dans `vues` **seulement** (rétention 90 j), pas d'agrégat, pas d'affichage en S11. Le brief impose la collecte (« appareil », « pays déduit des en-têtes ») ; l'affichage n'est pas au périmètre. Une dimension jamais affichée ne sera pas agrégée (règle : rien hors périmètre) ; si un détail appareil/pays arrive plus tard, il ajoutera son agrégat. |
| 178 | Robots | `isbot` (npm, maintenu, TypeScript) sur `user-agent` ; **UA absent = robot** (aucun navigateur honnête n'en envoie pas, un scraper non plus). Filtre **avant toute écriture**. Réponse **204 identique** en cas de robot, de vitrine inexistante ou de succès : aucun oracle pour un appelant. |
| 179 | Appareil | `ua-parser-js` (npm, standard de fait, types embarqués) : `type: 'mobile' → 'mobile'`, `'tablet' → 'tablette'`, `undefined → 'ordinateur'` (après filtrage robots, un UA sans type est un navigateur de bureau), `smarttv/console/wearable/embedded → 'inconnu'`. |
| 180 | Pays | Premier en-tête présent parmi `cf-ipcountry` (Cloudflare), `x-vercel-ip-country` (Vercel), `x-country-code`, format `^[A-Z]{2}$` → sinon `null`. **Aucune géoloc IP**, aucune librairie. |
| 181 | Source | `document.referrer` envoyé par le client. Règles (fonction pure, dans l'ordre) : absent ou égal à l'URL courante (rechargement) → `direct` ; origine **même domaine** (comparaison après retrait d'un `www.` préfixé) → `interne` ; hôte apparié à `SOURCES_HOTES` (suffixe égal ou `.suffixe` en fin de chaîne) → marque ; URL illisible ou hôte inconnu → `autre`. Liste bornée en `shared/statistiques.ts`, CHECK en base. |
| 182 | Normalisation de page | `vues` ne stocke **jamais** un chemin brut : `(page_type, page_identifiant)`. Types fermés : `accueil, service, realisation, agenda, contact, reservation, autre`. Identifiant : `''` (accueil, listes) ou slug `LISTE_SLUG_REGEX` ≤ `LISTE_SLUG_MAX`. Pour `service`/`realisation` avec slug non vide : existence **et** `actif` vérifiés en base (1 requête indexée) ; sinon → `autre, ''`. Cardinalité bornée par nature : un chemin arbitraire ne crée jamais de ligne. |
| 183 | Envoi de la vue | `POST /api/public/[username]/vue` → **204 + `Cache-Control: no-store`**. Côté client : plugin **`.client`** `app/plugins/suivi-visite.client.ts`, hook `page:finish` + `requestIdleCallback` (repli `setTimeout`), `fetch` **`keepalive: true`** — jamais pendant le SSR (contrat S12 : le microcache ne doit pas compter une vue au rendu), jamais bloquant le premier rendu. |
| 184 | Limiteur | `VUE_PUBLIC_LIMIT = { limit: 60, windowS: 60 }` par IP via `enforceLimit` (fail-open), clé `vue:{ip}`, **dans le service** (modèle exact de `recordLienClic`). Une 429 n'interrompt jamais la navigation (appel en arrière-plan). |
| 185 | Accueil studio | `statistiques7j` devient réel : `summarize()` appelle le lecteur de statistiques (période 7, détails non exigés), DTO typé `{ visites: number, clics: number, reservations: number }`. Dette `PROJECT_STATE.md` n° 6 levée dans le même sprint. |
| 186 | Résumé hebdomadaire | `prepareResumeHebdo` remplace `visites: null, clics: null` par les sommes de `statistiques_jour` sur la période `[debut, fin)` du résumé (`periodeResume`), avec la règle hybride #170 pour les jours récents (repli live sur `vues`). Contrat `number \| null` conservé (S9) ; `null` ne survit plus à S11 en conditions normales. |
| 187 | Seed | Données **déterministes** (PRNG à graine fixe) pour `dr-cabrel` : ~30 jours de `vues` + agrégats cohérents + clics agrégés réalistes (ordre de grandeur de la maquette : ~128 visites/7 j), répartis entre les types de page, sources, appareils. Suppression puis régénération des statistiques de `dr-cabrel` à chaque run (motif des purges du seed S9/S10). |
| 188 | Interface détail | Bouton « Voir le détail » sur la carte statistiques (`aria-expanded` + `aria-controls`), panneau avec les 4 états obligatoires (chargement skeleton, vide, erreur + Réessayer, contenu). Sélecteur de période = **`TarifsSelecteur` existant** (`URadioGroup` segmenté, aucun nouveau pattern) ; en plan gratuit,30 et 90 **désactivés** avec la phrase sobre « Les périodes de 30 et 90 jours sont incluses avec le plan payant. ». Aucun graphique. |
| 189 | Répartition par jour | **Incluse pour tous les plans** (le « totaux seuls » du brief porte sur les pages et les sources, pas sur le détail quotidien déjà promis par le nom « Statistiques des 7 derniers jours »). Ligne = date locale (fuseau de la vitrine) + visites, visiteurs uniques en texte secondaire, tri du plus récent au plus ancien. Coût nul : la répartition est la source même des totaux. |
| 190 | Bibliothèques | `isbot` et `ua-parser-js` ajoutées à `package.json` (motifs §CHALLENGE et #178/#179) ; deux lignes ajoutées à `CLAUDE.md` §8. Aucune autre dépendance : le reste (HMAC, Temporal, parsing referrer) utilise `node:crypto`, `@js-temporal/polyfill` et `new URL()` déjà présents. |

---

## 2. Migration `0022_s11_statistiques.sql`

Générée par `pnpm db:generate` depuis `shared/db/schema.ts` (drizzle), renommée `0022_s11_statistiques.sql` (motif S9/S10), revue ligne à ligne. Aucune donnée existante n'est touchée. `journal`/`snapshot` de drizzle mis à jour dans la foulée.

```sql
CREATE TABLE "vues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vitrine_id" uuid NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "empreinte" text NOT NULL,
  "page_type" text NOT NULL,
  "page_identifiant" text NOT NULL DEFAULT '',
  "source" text NOT NULL,
  "appareil" text NOT NULL,
  "pays" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vues_empreinte_check" CHECK ("empreinte" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "vues_page_type_check"
    CHECK ("page_type" IN ('accueil','service','realisation','agenda','contact','reservation','autre')),
  CONSTRAINT "vues_page_identifiant_check"
    CHECK (char_length("page_identifiant") <= 80
      AND ("page_identifiant" = '' OR "page_identifiant" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')),
  CONSTRAINT "vues_source_check"
    CHECK ("source" IN ('direct','interne','google','bing','duckduckgo','yahoo','facebook','instagram',
      'linkedin','twitter','x','youtube','tiktok','whatsapp','telegram','pinterest','reddit','autre')),
  CONSTRAINT "vues_appareil_check" CHECK ("appareil" IN ('mobile','tablette','ordinateur','inconnu')),
  CONSTRAINT "vues_pays_check" CHECK ("pays" IS NULL OR "pays" ~ '^[A-Z]{2}$')
);
CREATE INDEX "vues_vitrine_id_jour_idx" ON "vues" ("vitrine_id", "jour");
CREATE INDEX "vues_jour_idx" ON "vues" ("jour");

CREATE TABLE "statistiques_jour" (
  "vitrine_id" uuid NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "visites" integer DEFAULT 0 NOT NULL CHECK ("visites" >= 0),
  "visiteurs_uniques" integer DEFAULT 0 NOT NULL CHECK ("visiteurs_uniques" >= 0),
  "clics" integer DEFAULT 0 NOT NULL CHECK ("clics" >= 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("vitrine_id", "jour")
);

CREATE TABLE "statistiques_jour_pages" (
  "vitrine_id" uuid NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "page_type" text NOT NULL,
  "page_identifiant" text NOT NULL DEFAULT '',
  "visites" integer DEFAULT 0 NOT NULL CHECK ("visites" >= 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("vitrine_id", "jour", "page_type", "page_identifiant"),
  CONSTRAINT "spj_page_type_check"
    CHECK ("page_type" IN ('accueil','service','realisation','agenda','contact','reservation','autre')),
  CONSTRAINT "spj_page_identifiant_check"
    CHECK (char_length("page_identifiant") <= 80
      AND ("page_identifiant" = '' OR "page_identifiant" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'))
);

CREATE TABLE "statistiques_jour_sources" (
  "vitrine_id" uuid NOT NULL REFERENCES "vitrines"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "jour" date NOT NULL,
  "source" text NOT NULL,
  "visites" integer DEFAULT 0 NOT NULL CHECK ("visites" >= 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("vitrine_id", "jour", "source"),
  CONSTRAINT "sjs_source_check"
    CHECK ("source" IN ('direct','interne','google','bing','duckduckgo','yahoo','facebook','instagram',
      'linkedin','twitter','x','youtube','tiktok','whatsapp','telegram','pinterest','reddit','autre'))
);
```

Notes :
- **`ON DELETE CASCADE`** sur les 4 tables : la suppression d'une vitrine purge tout (motif existant).
- **Deux index sur `vues`** : `(vitrine_id, jour)` pour les lectures hybrides et le live top-pages ; `(jour)` seul pour la purge (qui n'a pas de vitrine).
- **`page_identifiant` `NOT NULL DEFAULT ''`** : la clé primaire des pages accepte la chaîne vide (accueil, listes) sans `NULL` interdit dans une PK.
- **Pas d'index sur les agrégats** : la PK sert de clé de lecture (`WHERE vitrine_id = ? AND jour BETWEEN ? AND ?`).

---

## 3. Contrats `shared/`

### 3.1 `shared/statistiques.ts` (nouveau, pur : constantes et types, aucune logique serveur)

```ts
export const PERIODES_STATISTIQUES = [7, 30, 90] as const
export type PeriodeStat = (typeof PERIODES_STATISTIQUES)[number]

export const PAGES_STAT = ['accueil', 'service', 'realisation', 'agenda', 'contact', 'reservation', 'autre'] as const
export type PageStat = (typeof PAGES_STAT)[number]
export const LIBELLES_PAGES: Record<PageStat, string> = {
  accueil: 'Accueil',
  service: 'Service',
  realisation: 'Réalisation',
  agenda: 'Agenda',
  contact: 'Contact',
  reservation: 'Réservation',
  autre: 'Autre page',
}

export const SOURCES_STAT = ['direct', 'interne', 'google', 'bing', 'duckduckgo', 'yahoo', 'facebook',
  'instagram', 'linkedin', 'twitter', 'x', 'youtube', 'tiktok', 'whatsapp', 'telegram',
  'pinterest', 'reddit', 'autre'] as const
export type SourceStat = (typeof SOURCES_STAT)[number]
export const LIBELLES_SOURCES: Record<SourceStat, string> = {
  direct: 'Accès direct', interne: 'Depuis votre vitrine', google: 'Google', bing: 'Bing',
  duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', facebook: 'Facebook', instagram: 'Instagram',
  linkedin: 'LinkedIn', twitter: 'X (Twitter)', x: 'X (Twitter)', youtube: 'YouTube',
  tiktok: 'TikTok', whatsapp: 'WhatsApp', telegram: 'Telegram', pinterest: 'Pinterest',
  reddit: 'Reddit', autre: 'Autre source',
}
/** Suffixes d'hôtes appariés (égalité ou fin de chaîne `.{suffixe}`), le plus long d'abord à l'usage. */
export const SOURCES_HOTES: readonly { suffixe: string, source: SourceStat }[] = [
  { suffixe: 'google.com', source: 'google' }, { suffixe: 'google.fr', source: 'google' },
  { suffixe: 'google.co.uk', source: 'google' }, { suffixe: 'google.de', source: 'google' },
  { suffixe: 'google.cm', source: 'google' }, { suffixe: 'bing.com', source: 'bing' },
  { suffixe: 'duckduckgo.com', source: 'duckduckgo' }, { suffixe: 'yahoo.com', source: 'yahoo' },
  { suffixe: 'facebook.com', source: 'facebook' }, { suffixe: 'fb.me', source: 'facebook' },
  { suffixe: 'instagram.com', source: 'instagram' }, { suffixe: 'linkedin.com', source: 'linkedin' },
  { suffixe: 'twitter.com', source: 'twitter' }, { suffixe: 'x.com', source: 'x' },
  { suffixe: 't.co', source: 'x' }, { suffixe: 'youtube.com', source: 'youtube' },
  { suffixe: 'youtu.be', source: 'youtube' }, { suffixe: 'tiktok.com', source: 'tiktok' },
  { suffixe: 'whatsapp.com', source: 'whatsapp' }, { suffixe: 'telegram.org', source: 'telegram' },
  { suffixe: 't.me', source: 'telegram' }, { suffixe: 'pinterest.com', source: 'pinterest' },
  { suffixe: 'reddit.com', source: 'reddit' },
]

export const APPAREILS_STAT = ['mobile', 'tablette', 'ordinateur', 'inconnu'] as const
export type AppareilStat = (typeof APPAREILS_STAT)[number]

/** En-tête de pays, dans l'ordre de priorité. */
export const ENTETES_PAYS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'] as const
export const PAYS_FORMAT = /^[A-Z]{2}$/

export const VUES_RETENTION_JOURS = 90
export const STATISTIQUES_RETENTION_JOURS = 180
export const AGGREGATION_FENETRE_JOURS = 4
export const STATISTIQUES_PAGES_MAX = 10

export const EMPREINTE_HKDF_INFO = 'brandself-statistiques-visite-v1'
export const EMPREINTE_LONGUEUR = 64
```

> Ce fichier est importé par `app/` uniquement en **types** (DTO) : aucune dépendance serveur (`isbot`, `ua-parser-js`) n'y figure, sinon elles seraient embarquées dans le bundle client (budget S12).

### 3.2 Schémas Zod (`shared/schemas/statistiques.ts`)

```ts
/** Corps de POST /api/public/[username]/vue : le navigateur envoie le chemin affiché, jamais une URL complète. */
export const schemaVuePublic = z.object({
  chemin: z.string().min(1).max(300).regex(/^\/[a-z0-9\-/]*$/),
  origine: z.string().max(500).nullish(),
})

export const schemaStatistiquesQuery = z.object({
  periode: z.enum(['7', '30', '90']),
})
```

- `chemin` : `location.pathname` d'une page vitrine (segments `[a-z0-9-]` uniquement — usernames et slugs le sont). Toute valeur hors format → 400 `VALIDATION` (un client corrompu ne pollue pas la normalisation).
- `origine` : `document.referrer` (vide → `null`). Non validée comme URL ici : le service applique les règles #181 sur un `new URL()` en `try/catch`.

### 3.3 DTO (`shared/dto/statistiques.ts`, réexport dans `shared/dto/index.ts`)

```ts
export interface PageStatDTO {
  type: PageStat
  /** `''` pour une liste ou l'accueil. */
  identifiant: string
  libelle: string
  visites: number
}

export interface SourceStatDTO {
  source: SourceStat
  libelle: string
  visites: number
}

export interface JourStatDTO {
  /** Jour civil `AAAA-MM-JJ` dans le fuseau de la vitrine. */
  jour: string
  visites: number
  visiteursUniques: number
}

export interface StatistiquesDTO {
  periode: PeriodeStat
  /** Limite du plan (7 ou 90) : le client affiche ce qu'il a le droit de demander. */
  joursMax: number
  totaux: { visites: number, visiteursUniques: number, clics: number, reservations: number }
  parJour: JourStatDTO[]
  /** `null` hors plan (#176) — jamais un tableau vide qui ferait croire à « 0 page ». */
  pages: PageStatDTO[] | null
  sources: SourceStatDTO[] | null
}
```

Modification concomitante dans `shared/dto/vitrine.ts` :

```ts
// avant : statistiques7j: { visites: 0, clics: 0, reservations: 0 }
statistiques7j: { visites: number, clics: number, reservations: number }
```

### 3.4 Erreurs (`shared/erreurs.ts` + `server/exceptions/http.ts`)

| Code | HTTP | Message |
|---|---|---|
| `STATISTIQUES_PERIODE_INTERDITE` | 403 | « Cette période n’est pas incluse dans votre plan. » |

Ajouts : constante dans `ERROR_CODES`, entrée `STATISTIQUES_PERIODE_INTERDITE: 403` dans `ERROR_STATUS`, message dans `ERROR_MESSAGES`. `ErrorData` expose `periode?: number` et `joursMax?: number` (comme `limite`/`plan` pour `LIMITE_PLAN_ATTEINTE`). `useApiErreur` l'affiche déjà (code inconnu = repli message serveur) — vérifier le rendu, aucune modification attendue.

### 3.5 Limites, jobs, configuration

- `shared/limites.ts` : `VUE_PUBLIC_LIMIT: RateLimit = { limit: 60, windowS: 60 }` et `VUE_LIMITE_CLE_PREFIXE = 'vue:'`.
- `shared/jobs.ts` : `JOBS.agregerStatistiques = 'statistiques-agreger'`, `JOBS.purgerStatistiques = 'statistiques-purger'`.
- `server/config/plans.ts` : `ConfigPlan` gagne `statistiquesDetails: boolean` (gratuit `false`, payant `true`). `statistiquesJours` existe déjà.
- Aucune nouvelle variable d'environnement.

---

## 4. Collecte : `POST /api/public/[username]/vue`

### 4.1 Empreinte (#167)

```
cle    = hkdfSync('sha256', env.NUXT_BETTER_AUTH_SECRET, Buffer.alloc(0), EMPREINTE_HKDF_INFO, 32)
empreinte = createHmac('sha256', cle).update(`${jourIso}|${vitrineId}|${ip}`).digest('hex')  // 64 caractères
```

- `jourIso` = `jour` local calculé pour l'écriture (partie du message : le sel change à minuit locale).
- `'inconnue'` (IP inconnue) est une valeur comme une autre : la ligne existe, la collision de comptage entre visiteurs sans IP est un cas marginal (réseau d'entreprise, IP non transmise) — assumé.
- Fonction pure `empreinteVisite(jourIso, vitrineId, ip, cle)` dans `server/services/statistiques-regles.ts`, testable sans base.

### 4.2 Ordre des filtres dans `enregistrerVue` (service, jamais la route)

1. `enforceLimit(VUE_LIMITE_CLE_PREFIXE + ip, …)` → 429 `TROP_DE_REQUETES` (fail-open si Redis est absent : la collecte ne peut jamais faire tomber la vitrine).
2. `estRobot(userAgent)` (`isbot`, UA `null`/vide inclus) → **retour silencieux**, zéro écriture.
3. `getPublicVitrine(username)` → 404 `VITRINE_INTROUVABLE` si inconnue ou non publiée (déjà la règle des pages publiques).
4. Calcul du `jour` local (`fuseau` de la vitrine), de la page (#183), de la source (#181), de l'appareil (#179), du pays (#180).
5. `insert(vues).values({ … })` — une ligne, jamais d'upsert (chaque vue est un événement).

### 4.3 Normalisation de page (#182)

Fonction pure `normaliserPage(chemin: string): { type: PageStat, identifiant: string }` — totale, jamais d'exception :

| `chemin` | Résultat |
|---|---|
| `/` ou `/dr-cabrel` ou `/dr-cabrel/` | `accueil, ''` |
| `/dr-cabrel/services` | `service, ''` |
| `/dr-cabrel/services/mon-cabinet` | `service, 'mon-cabinet'` (puis vérification en base) |
| `/dr-cabrel/realisations` | `realisation, ''` |
| `/dr-cabrel/realisations/projet-x` | `realisation, 'projet-x'` (puis vérification en base) |
| `/dr-cabrel/agenda` | `agenda, ''` |
| `/dr-cabrel/contact` | `contact, ''` |
| `/dr-cabrel/reserver` | `reservation, ''` |
| `/dr-cabrel/reserver/confirmation` | `reservation, 'confirmation'` |
| `/@dr-cabrel` | `autre, ''` |
| tout chemin inconnu, segment illisible, slug au mauvais format | `autre, ''` |

- La première segment (le username) est ignorée : le chemin est normalisé sans lui, la vitrine cible vient du paramètre de route.
- **Vérification en base** (service/réalisation uniquement, slug non vide) : `SELECT … WHERE vitrine_id = ? AND slug = ? AND actif` → introuvable ou inactif → `autre, ''`. Requête indexée unique (`services_vitrine_id_slug_unique`), faible coût, **bornement garanti** : un POST avec `/dr-cabrel/services/` + bruit ne crée jamais de ligne correspondante.
- Les libellés affichés sont calculés **côté serveur** à la lecture : slug trouvé → `titre` de la ligne ; introuvable (élément supprimé depuis) → `LIBELLES_PAGES[type]`.

### 4.4 Source, appareil, pays (#178 à #181)

- `classifierSource(origine: string | null, cheminCourant: string, siteOrigin: string): SourceStat` — pure, testable : règles #181, `siteOrigin` passé en paramètre (`env.NUXT_PUBLIC_SITE_URL` en production), comparaison d'hôtes après retrait d'un `www.`.
- `classifierAppareil(userAgent: string | null): AppareilStat` — `ua-parser-js`, règles #179.
- `paysDepuisEntetes(headers): string | null` — règles #180.
- `estRobot(userAgent: string | null): boolean` — `isbot`, `null`/`''` → vrai.

### 4.5 Route et service

**Route** `server/api/public/[username]/vue.post.ts` (modèle exact de `clic.post.ts`) :

```ts
const schemaParams = z.object({ username: z.string() })

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaParams)
  const body = await readBodyWith(event, schemaVuePublic)
  await enregistrerVue({
    username,
    chemin: body.chemin,
    origine: body.origine ?? null,
    ip: getClientIp(event),
    userAgent: getHeader(event, 'user-agent') ?? null,
    headers: event.node.req.headers,
    now: new Date(),
  })
  setResponseStatus(event, 204)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return null
})
```

Aucune logique dans la route (validation + délégation + réponse). `now` injectable = testable sans fausser l'horloge.

**Service** `server/services/statistiques.ts` :

```ts
export interface VueInput {
  username: string
  chemin: string
  origine: string | null
  ip: string
  userAgent: string | null
  headers: Record<string, string | string[] | undefined>
  now: Date
}
export async function enregistrerVue(input: VueInput): Promise<void>
```

### 4.6 Envoi navigateur (#183) — `app/plugins/suivi-visite.client.ts` (nouveau dossier)

```ts
export default defineNuxtPlugin((nuxtApp) => {
  // Un envoi par navigation, après rendu, jamais au SSR.
  nuxtApp.hook('page:finish', () => {
    const route = useRoute()
    const username = route.params.username
    if (typeof username !== 'string') return   // studio, tarifs, pages hors vitrine : rien
    const envoyer = () => {
      void fetch(`/api/public/${encodeURIComponent(username)}/vue`, {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chemin: window.location.pathname, origine: document.referrer || null }),
      }).catch(() => {})   // une vue perdue n'est jamais une erreur visible
    }
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 0))
    idle(envoyer, { timeout: 2000 })
  })
})
```

- **`page:finish`** couvre la navigation initiale (après hydratation) et chaque navigation SPA ; `route.params.username` filtre naturellement `studio/*`, `/`, `/tarifs`, `/connexion` (aucun paramètre).
- **Jamais pendant le SSR** (plugin `.client`) : le HTML servi — y compris mis en cache 10 s par nginx (S12) — ne déclenche aucune vue ; seule la navigation du navigateur en compte une.
- Rechargement = nouvelle vue (chaque rendu complet repasse par `page:finish`) — comportement analytique standard, assumé.
- Les visites du propriétaire (« Voir ma vitrine ») sont comptées : sans cookie ni identifiant, impossible à distinguer — assumé et documenté en §9.

---

## 5. Jobs

### 5.1 Agrégation `statistiques-agreger` (#173)

**Constantes** (dans `shared/statistiques.ts`) : cron `0 11 * * *`, `tz: 'UTC'`, scheduler id `statistiques-agreger`, file `maintenance`, `attempts: 1`, `removeOnComplete/Fail: true` (motifs S9 : un job raté est rattrapé par le suivant, la fenêtre fait 4 jours).

**Exécution** (service `agregerStatistiques(now: Date)`), 3 requêtes, chacune autonome :

```sql
-- 1) Totaux (INSERT … ON CONFLICT DO UPDATE, JAMAIS `clics`)
INSERT INTO statistiques_jour (vitrine_id, jour, visites, visiteurs_uniques, clics, created_at, updated_at)
SELECT v.vitrine_id, v.jour, COUNT(*), COUNT(DISTINCT v.empreinte), 0, now(), now()
FROM vues v
WHERE v.jour >= (${nowUtcDate} - ${AGGREGATION_FENETRE_JOURS})::date
GROUP BY v.vitrine_id, v.jour
ON CONFLICT (vitrine_id, jour) DO UPDATE
SET visites = EXCLUDED.visites,
    visiteurs_uniques = EXCLUDED.visiteurs_uniques,
    updated_at = now();

-- 2) Pages (même fenêtre, même motif, clé 4 colonnes)
INSERT INTO statistiques_jour_pages (vitrine_id, jour, page_type, page_identifiant, visites, created_at, updated_at)
SELECT v.vitrine_id, v.jour, v.page_type, v.page_identifiant, COUNT(*), now(), now()
FROM vues v
WHERE v.jour >= (${nowUtcDate} - ${AGGREGATION_FENETRE_JOURS})::date
GROUP BY v.vitrine_id, v.jour, v.page_type, v.page_identifiant
ON CONFLICT (vitrine_id, jour, page_type, page_identifiant) DO UPDATE
SET visites = EXCLUDED.visites, updated_at = now();

-- 3) Sources (identique, clé 3 colonnes)
```

**Idempotence** : re-exécuter recalcule les mêmes valeurs depuis `vues` (les vues d'un jour passé ne changent plus). **Jamais d'écrasement à zéro** : un `(vitrine_id, jour)` sans ligne dans `vues` ne produit aucune écriture → une ligne créée uniquement par des clics (#171) survit. Les vues « aujourd'hui » produisent un agrégat partiel qui n'est jamais lu (#170) et sera réécrit complet.

### 5.2 Purge `statistiques-purger` (#174)

```sql
DELETE FROM vues WHERE jour < (${nowUtcDate} - ${VUES_RETENTION_JOURS})::date;
DELETE FROM statistiques_jour_sources WHERE jour < (${nowUtcDate} - ${STATISTIQUES_RETENTION_JOURS})::date;
DELETE FROM statistiques_jour_pages   WHERE jour < (${nowUtcDate} - ${STATISTIQUES_RETENTION_JOURS})::date;
DELETE FROM statistiques_jour          WHERE jour < (${nowUtcDate} - ${STATISTIQUES_RETENTION_JOURS})::date;
```

Ordre : pages/sources avant les totaux (cohérence d'affichage si le worker s'arrête au milieu). Idempotente, retourne le nombre de lignes supprimées pour le journal du worker.

### 5.3 Worker (`worker/index.ts`)

- `workerMaintenance` : deux nouveaux `if (job.name === …)` appelant `agregerStatistiques(new Date())` / `purgerStatistiques(new Date())`, journal en nombres uniquement (motif S9).
- Bas de page : `planifierAgregationStatistiques(maintenanceQueue)` et `planifierPurgeStatistiques(maintenanceQueue)` dans `server/jobs/statistiques.ts`, sur le modèle exact de `server/jobs/notifications.ts` (`upsertJobScheduler(id, { pattern, tz }, { name, data: {}, opts })`), `.catch` silencieux comme les voisines.

### 5.4 Seed (`server/db/seed.ts`)

- Supprime les `vues`/`statistiques_jour*` de `dr-cabrel`, puis régénère de façon **déterministe** (PRNG mulberry32, graine fixe) : 30 jours locaux, ~8 à 28 visites/jour (week-ends en moins), empreintes hex64 factices mais conformes au CHECK, répartition accueil 45 % / listes 20 % / services 15 % / réalisations 10 % / agenda-contact-réservation 10 %, sources (direct 40 %, google 25 %, interne 10 %, facebook 10 %, whatsapp 5 %, autre 10 %), appareils (mobile 70 %, ordinateur 25 %, tablette 5 %), pays (CM 70 %, null 20 %, 10 % autres), puis agrégats cohérents calculés à partir des mêmes lignes, clics agrégés 5 à 15 % des visites. Aujourd'hui partiel compris : la ligne de l'accueil affiche des chiffres dès le premier `pnpm db:seed`.
- Idempotent : deux coups de suite = mêmes données.

---

## 6. API studio : `GET /api/studio/statistiques`

**Route** `server/api/studio/statistiques/index.get.ts` :

```ts
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { periode } = readQueryWith(event, schemaStatistiquesQuery)   // 400 hors {7,30,90}
  return await getStatistiques(user.id, Number(periode), new Date())
})
```

**Service** `getStatistiques(userId, periode, now): Promise<StatistiquesDTO>` :

1. Charger la vitrine du compte (`id`, `username`, `fuseau`) → 404 `VITRINE_INTROUVABLE` si absente.
2. `getPlanEffectif(userId, now)` ; `joursMax = PLANS[plan].statistiquesJours`.
3. Si `periode > joursMax` → `ForbiddenError('STATISTIQUES_PERIODE_INTERDITE', { periode, joursMax })`.
4. Bornes : `debut = aujourd'hui_local - (periode - 1)`, `fin = aujourd'hui_local` (7 jours **inclus** : aujourd'hui compris).
5. **Lecture hybride (#170)** :
   - jours `>= aujourd'hui - 1` : `GROUP BY jour, page_type, page_identifiant` (+ `source`) sur `vues` dans la fenêtre ;
   - jours plus anciens : lecture des 3 agrégats (lignes manquantes = zéro) ;
   - clics : `statistiques_jour.clics` sur toute la fenêtre (ligne absente = 0) ;
   - réservations : `COUNT(*) FROM reservations WHERE vitrine_id = ? AND created_at >= debutInstant AND < now` (tous statuts, #172).
6. Assemblage : `parJour` trié décroissant, `totaux` = sommes, `pages`/`sources` top `STATISTIQUES_PAGES_MAX` (tri `visites DESC`, départage déterministe) **seulement si `PLANS[plan].statistiquesDetails`**, sinon `null`.
7. Libellés pages calculés ici (titres des services/réalisations des top-pages par une jointure unique, repli `LIBELLES_PAGES`).

La couche HTTP ne contient aucune logique ; la réponse est un DTO construit par le service (jamais une ligne ORM).

---

## 7. Branchements existants

### 7.1 Ligne de chiffres de l'accueil studio (#185)

- `summarize()` (`server/services/vitrines.ts`) appelle `getStatistiques(userId, 7, now)` (ou un sous-ensemble `getTotaux7j` partageant le même lecteur — **une seule implémentation de lecture**) et ajoute `statistiques7j` à `StudioSummary`.
- `server/resources/vitrine.ts` : `statistiques7j: { ...resume.statistiques7j }` au lieu des littéraux `0`.
- `shared/dto/vitrine.ts` : types `number` (commit concomitant, cf. angle mort 5).
- Coût : 3 à 5 requêtes indexées de plus au chargement de l'accueil studio — acceptable (page studio, pas publique).

### 7.2 Résumé hebdomadaire (#186)

- `prepareResumeHebdo` (`server/services/email-outbox.ts`) remplace les deux `null` par `getCompteursResume(vitrineId, fuseau, periode)` : sommes de `statistiques_jour` sur `jour >= date(debut) AND jour < date(fin)` (bornes de `periodeResume`), **règle hybride** pour les jours `>= aujourd'hui - 1` (repli live `vues`).
- `CompteursResume` et `lignesCompteurs` ne changent pas : le contrat `number | null` de S9 est conservé, les lignes « • Visites : N » et « • Clics sur vos liens : M » apparaissent naturellement.
- Échec de lecture → repli `null` (un résumé n'est jamais bloqué par ses statistiques, motif S9).

---

## 8. Frontend studio

**Composable** `app/composables/useStatistiques.ts` :

- État : `periode` (7 par défaut), `donnees: StatistiquesDTO | null`, `chargement`, `erreur`.
- Chargement sur ouverture du panneau **et** changement de période : `useFetch`/`$fetch` vers `GET /api/studio/statistiques?periode=…`, erreurs via `useApiErreur` (403 → message + repli sur 7, 401 → session).
- `periodes` dérivées de la réponse (`joursMax`) : `7` toujours active ; `30` et `90` **désactivées** si `joursMax < periode`.

**Composant** `app/components/studio/StatistiquesDetail.vue` — carte sous les trois chiffres de l'accueil :

1. **En-tête** : bouton « Voir le détail » (`aria-expanded`, `aria-controls="detail-statistiques"`), même état d'interaction que les boutons du studio (normal, survol, focus visible, désactivé, chargement).
2. **Sélecteur de période** : réutilise `TarifsSelecteur` (`URadioGroup` segmenté horizontal, `legend` lisible par lecteur d'écran) avec les items `7 j / 30 j / 90 j` ; phrase sobre pour le gratuit (#188).
3. **Totaux** : 4 chiffres (visites, visiteurs uniques, clics sur les liens, réservations) — vocabulaire `vitrine`/`réservation` uniquement.
4. **Par jour** : liste `<ul>`, une ligne par jour (date locale + visites, visiteurs uniques en secondaire), décroissant (#189) — présente pour tous les plans.
5. **Pages les plus vues** et **Sources** : listes simples (libellé + visites), **absentes** (pas de trou, pas de message) en plan gratuit ; top 10 au maximum.
6. **États** : skeleton (`USkeleton`) au chargement, « Aucune visite pour cette période. » si `totaux.visites === 0 && clics === 0 && reservations === 0`, erreur avec bouton « Réessayer » (`role="status"` pour les annonces). Un seul message à l'écran (règle interface 6).
7. **Mobile 390 px** : lignes ≥ 44 px, aucun titre modifié de couleur ni en italique, icônes Phosphor uniquement, aucune couleur en dur.

Le détail est un panneau du studio : aucune page dédiée, aucune URL de statistiques (hors périmètre).

---

## 9. Confidentialité (section obligatoire)

- **Minimisation** : une ligne de `vues` contient une **empreinte HMAC journalière et par vitrine** (jamais l'IP, jamais la clé — le CHECK hex64 l'interdit), un jour, un type de page, une source, un appareil, un pays. Aucun cookie, aucun identifiant persistant, aucun fingerprint navigateur, aucun contenu de page.
- **Non-ré-identification** : changer de vitrine ou de jour change le message HMAC → la même IP d'un visiteur n'est pas correlable d'un jour à l'autre ni entre vitrines (le comptage quotidien est volontairement cloisonné).
- **Rétention** : lignes brutes **90 jours** (purge `statistiques-purger`), agrégats **180 jours**. Au-delà, il ne reste aucune donnée individuelle — les agrégats ne contiennent que des sommes.
- **Aucun export IP** : il n'existe aucune route, aucun export, aucun journal contenant l'IP ou l'empreinte (les journaux du worker n'écrivent que des compteurs).
- **Limiteur** : 60 envois/minute/IP (fail-open) — pas de collecte en masse depuis une seule IP.
- **Robots** : `isbot` filtrés avant écriture — aucun crawl alimente les chiffres.
- **Visites du propriétaire comptées** (cf. §4.6) : choix assumé, sans cookie impossible à exclure proprement.
- **Page Confidentialité** : à compléter lors du sprint dédié (S9 Q8) — mentionner rétention 90/180 j, absence de cookie, absence d'export ; **hors périmètre S11**, noté pour le rapport.

---

## 10. Critères d'acceptation (Given / When / Then)

### Collecte
- **CA01 [I] — N visites comptées.** *Given* une vitrine publiée, *when* `POST /vue` 5 fois (UA de navigateur, chemins variés), *then* 5 lignes en base et `GET /api/studio/statistiques?periode=7` renvoie `totaux.visites = 5` (jour courant lu en direct).
- **CA02 [I] — Robot non compté.** *Given* `User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`, *when* `POST /vue`, *then* 204 et **zéro** ligne insérée.
- **CA03 [I] — IP brute absente.** *Given* une vue enregistrée depuis `203.0.113.7`, *when* `SELECT count(*) FROM vues WHERE empreinte LIKE '%203.0.113.7%' OR page_identifiant LIKE …` sur toutes les colonnes texte, *then* `0` ; `empreinte` matche `^[a-f0-9]{64}$`.
- **CA04 [U] — Sel quotidien.** *When* `empreinteVisite` est appelée avec la même IP : `jour1 ≠ jour2`, même jour `=`, jour identique mais vitrine différente `≠`.
- **CA05 [I] — Jour dans le fuseau de la vitrine.** *Given* `fuseau = Africa/Douala` (UTC+1), *when* la vue est reçue à `2026-01-01T23:30:00Z` (`now` injecté), *then* `jour = 2026-01-02`.
- **CA06 [I] — Limiteur.** *When* 60 `POST /vue` réussissent en une minute depuis une IP, *then* la 61e renvoie 429 `TROP_DE_REQUETES` avec `Retry-After`.
- **CA07 [I] — Hors vitrine publiée.** *Given* username inconnu ou vitrine non publiée, *when* `POST /vue`, *then* 404 `VITRINE_INTROUVABLE` et zéro ligne.
- **CA08 [U] — Normalisation.** *When* `normaliserPage` reçoit la matrice du §4.3 (dont `/@dr-cabrel`, chemin inconnu, slug au mauvais format), *then* les types/identifiants attendus, sans exception.
- **CA09 [I] — Slug inexistant.** *Given* `POST /vue` avec `/dr-cabrel/services/qui-nexiste-pas`, *when* l'agrégation tourne, *then* aucune ligne `statistiques_jour_pages` avec cet identifiant (la vue est comptée en `autre`).
- **CA10 [U] — Sources.** *When* `classifierSource` reçoit : absent → `direct` ; URL courante (rechargement) → `direct` ; origine même domaine → `interne` ; `https://www.google.com/search` → `google` ; `https://spam.example/` → `autre` ; URL illisible → `autre`.
- **CA11 [U] — Appareil et robots.** *When* UA iPhone → `mobile` ; UA de bureau sans type → `ordinateur` ; UA absent → 204 **et** zéro ligne (robot avant tout).
- **CA12 [U] — Pays.** *When* `cf-ipcountry: CM` → `CM` ; en-tête absent → `null` ; `cf-ipcountry: cm` (minuscules) → `null`.

### Agrégation et purge
- **CA13 [I] — Agrégation idempotente.** *Given* des vues sur la veille locale et un agrégat `clics = 5` préexistant, *when* `agregerStatistiques` tourne deux fois, *then* mêmes `visites`/`visiteurs_uniques` aux deux coups et `clics` **toujours 5**.
- **CA14 [I] — Aucun groupe, aucune écriture.** *Given* aucun `vues` dans la fenêtre, *when* le job tourne, *then* aucune ligne créée et un agrégat existant (clics seuls) inchangé.
- **CA15 [I] — Purge et survie des agrégats.** *Given* une vue à 91 jours et un agrégat à 95 jours, *when* `purgerStatistiques` tourne, *then* la vue est supprimée, l'agrégat présent ; un agrégat à 181 jours est supprimé, un agrégat à 179 jours survit (CA de rétention : agrégat > âge de la purge des vues = preuve que la lecture des jours anciens ne dépend plus des vues).
- **CA16 [I] — Lecture hybride.** *Given* la veille locale sans agrégat (job pas encore exécuté), *when* `GET /api/studio/statistiques?periode=7`, *then* les visites de la veille apparaissent (live) ; un jour minus 2 sans agrégat compte 0.

### API studio et plan
- **CA17 [I] — Gratuit, période 7.** *Given* plan gratuit, *when* `GET …?periode=7`, *then* 200, `joursMax = 7`, `parJour` de 7 jours, `pages = null`, `sources = null`.
- **CA18 [I] — Gratuit, période 30 → 403 explicite.** *When* `GET …?periode=30`, *then* 403 `STATISTIQUES_PERIODE_INTERDITE`, `data = { periode: 30, joursMax: 7 }`, **jamais** un 7 silencieux.
- **CA19 [I] — Période inconnue → 400.** *When* `GET …?periode=14`, *then* 400 `VALIDATION`.
- **CA20 [I] — Payant, période 90 avec détails.** *Given* plan payant, *when* `GET …?periode=90`, *then* 200, `joursMax = 90`, `pages` (≤ 10, libellés lisibles) et `sources` non nuls.
- **CA21 [I] — Réservations tous statuts.** *Given* 2 réservations créées dans la fenêtre (dont une `annulee`) et 1 créée hors fenêtre, *when* la lecture a lieu, *then* `totaux.reservations = 2`.
- **CA22 [I] — Clics incrémentés et non écrasés.** *Given* un clic enregistré, *when* `GET …?periode=7` puis `agregerStatistiques`, *then* `totaux.clics = 1` avant comme après l'agrégation.

### Branchements
- **CA23 [I] — Ligne de l'accueil réelle.** *Given* 5 vues et 2 clics sur la période, *when* `GET /api/studio/vitrine`, *then* `resume.statistiques7j = { visites: 5, clics: 2, reservations: … }`, valeurs numériques (plus de littéraux `0`).
- **CA24 [I] — Résumé hebdo alimenté.** *Given* des agrégats sur la période du résumé, *when* `prepareResumeHebdo` prépare l'e-mail, *then* `compteurs.visites` et `compteurs.clics` sont des nombres égaux aux sommes, et le corps contient « • Visites : N » et « • Clics sur vos liens : M ».
- **CA25 [I] — Seed réaliste et déterministe.** *When* `pnpm db:seed` tourne deux fois, *then* mêmes données à chaque fois et `dr-cabrel` a des visites > 0 sur les 7 derniers jours (l'accueil n'affiche plus 0/0/0).

### Interface (e2e)
- **CA26 [E] — Envoi réel depuis le navigateur.** *When* Playwright navigue sur 3 pages publiques d'une vitrine, *then* 3 requêtes `POST /api/public/*/vue` sont observées (`page.waitForRequest`), corps JSON conforme, et la ligne de l'accueil du studio affiche un nombre (0 compris sur vitrine fraîche).
- **CA27 [E] — Robot côté navigateur.** *Given* un contexte avec `User-Agent` Googlebot, *when* les pages sont visitées puis le studio ouvert, *then* la ligne de chiffres n'a pas bougé (filtre serveur, CA02).
- **CA28 [E] — Détail et plan gratuit.** *When* le bouton « Voir le détail » est activé, *then* `aria-expanded="true"`, le sélecteur et les listes s'affichent ; en plan gratuit 30/90 sont `disabled` avec la phrase de déblocage ; sur vitrine sans visite, l'état vide s'affiche ; un seul message à la fois.
- **CA29 [I/API] — Sécurité de la route studio.** *When* `GET /api/studio/statistiques` sans session → 401 ; avec session gratuite et `periode=30` → 403 (déjà CA18, exécuté aussi via `request` sans navigateur).

---

## 11. Plan de tests

| Fichier | Type | Contenu |
|---|---|---|
| `tests/unit/statistiques-regles.test.ts` | unitaire (pur) | `empreinteVisite` (CA04, hex64, bornes), `normaliserPage` (CA08, matrice complète), `classifierSource` (CA10), `classifierAppareil` (CA11), `estRobot` (UA absents, navigateurs, crawlers), `paysDepuisEntetes` (CA12), calcul des bornes de période en fuseau `Africa/Douala` (traversée de mois, 7/30/90 jours incluant aujourd'hui), `periodesAutorisees` (gratuit/payant, pur). |
| `tests/unit/statistiques-contrats.test.ts` | unitaire | Schémas Zod (`chemin` invalide → erreur, `periode=14` → erreur, `origine` absente), forme du DTO (pages/sources `null` vs tableaux), `STATISTIQUES_PERIODE_INTERDITE` dans `ERROR_STATUS` + message. |
| `tests/integration/statistiques.test.ts` | intégration (vraie base + h3) | CA01, CA02, CA03 (SQL), CA05 (`now` injecté), CA06, CA07, CA09, CA13, CA14, CA15, CA16, CA17→CA22, CA23, CA24. Faux événements via `tests/support/h3.ts`, limites Redis réelles (motif des tests de limiteur existants). |
| `tests/integration/migration-0022.test.ts` | intégration | Les 4 tables existent, CHECKs actifs (insertion d'une IP brute refusée, slug invalide refusé, pays `fr` refusé), PK/unicité, cascade de suppression. |
| `tests/integration/seed-statistiques.test.ts` | intégration | CA25 (deux runs idempotents, agrégats cohérents avec les vues générées). |
| `e2e/statistiques.spec.ts` | e2e (navigateur) | CA26, CA27, CA28. |
| `e2e/api/parcours-vitrine.spec.ts` | existant | Revérification de l'assert `statistiques7j` (angle mort 8) : inchangé attendu. |

Gate sprint : `pnpm lint`, `pnpm typecheck`, `pnpm test` verts **sans aucun test sauté** ; sortie de `pnpm build` collée ; sortie brute des tests collée.

---

## 12. Fichiers prévus

### Créés

| Fichier | Rôle |
|---|---|
| `shared/statistiques.ts` | Constantes et types purs (#167 à #190) |
| `shared/schemas/statistiques.ts` | `schemaVuePublic`, `schemaStatistiquesQuery` |
| `shared/dto/statistiques.ts` | `StatistiquesDTO` et sous-DTO |
| `server/services/statistiques-regles.ts` | Fonctions pures : empreinte, normalisation, classifieurs, bornes |
| `server/services/statistiques.ts` | `enregistrerVue`, `getStatistiques`, `getTotaux7j`, `getCompteursResume`, `agregerStatistiques`, `purgerStatistiques` |
| `server/resources/statistiques.ts` | DTO de lecture (libellés, formats de date) |
| `server/jobs/statistiques.ts` | `planifierAgregationStatistiques`, `planifierPurgeStatistiques` |
| `server/api/public/[username]/vue.post.ts` | Route de collecte |
| `server/api/studio/statistiques/index.get.ts` | Route studio |
| `app/plugins/suivi-visite.client.ts` | Envoi discret (dossier `app/plugins/` à créer) |
| `app/composables/useStatistiques.ts` | État du panneau détail |
| `app/components/studio/StatistiquesDetail.vue` | Panneau détail |
| `server/db/migrations/0022_s11_statistiques.sql` | + `journal`/`snapshot` drizzle |
| `tests/unit/statistiques-regles.test.ts` | Règles pures |
| `tests/unit/statistiques-contrats.test.ts` | Schémas et contrats |
| `tests/integration/statistiques.test.ts` | Collecte, jobs, API, branchements |
| `tests/integration/migration-0022.test.ts` | Contraintes SQL |
| `tests/integration/seed-statistiques.test.ts` | Idempotence du seed |
| `e2e/statistiques.spec.ts` | Parcours navigateur |
| `e2e/helpers/statistiques.ts` | `attendreVues(page, n)`, compteur via `db()` |

### Modifiés

| Fichier | Changement |
|---|---|
| `shared/db/schema.ts` | 4 tables + CHECKs + index |
| `shared/dto/vitrine.ts` | `statistiques7j` → `number` |
| `shared/dto/index.ts` | Réexport du nouveau DTO |
| `shared/erreurs.ts` | `STATISTIQUES_PERIODE_INTERDITE` |
| `server/exceptions/http.ts` | Message + `ErrorData.periode/joursMax` |
| `shared/limites.ts` | `VUE_PUBLIC_LIMIT`, préfixe de clé |
| `shared/jobs.ts` | 2 noms de jobs |
| `server/config/plans.ts` | `ConfigPlan.statistiquesDetails` |
| `server/services/liens.ts` | `recordLienClic` : incrément `statistiques_jour.clics` en transaction |
| `server/services/vitrines.ts` | `summarize` → `statistiques7j` réel |
| `server/resources/vitrine.ts` | Ligne 49 : plus de littéraux `0` |
| `server/services/email-outbox.ts` | `prepareResumeHebdo` : visites/clics réels |
| `server/db/seed.ts` | Statistiques déterministes `dr-cabrel` |
| `worker/index.ts` | 2 handlers + 2 planifications `maintenance` |
| `app/pages/studio/index.vue` | Bouton + ancrage du panneau détail |
| `package.json` / `pnpm-lock.yaml` | `isbot`, `ua-parser-js` |
| `CLAUDE.md` §8 | 2 lignes de bibliothèques |
| `PROJECT_STATE.md`, `docs/JOURNAL_DECISIONS.md` | Finale du sprint (#167 à #190) |

**Fichiers explicitement non touchés** : `nuxt.config.ts` (aucune option), `server/jobs/queues.ts` (`maintenance` existe), `app/pages/[username]/*` (le plugin est global), `shared/reserved.ts`, `.env.example` (aucune variable).

---

## 13. Questions ouvertes (avec proposition)

1. **Répartition par jour pour le plan gratuit.** Le brief dit « gratuit : totaux seuls ». *Proposition : inclure la liste par jour* (#189) — elle est la source même des totaux (coût nul), elle répond au besoin « est-ce que ça bouge ? » bien mieux que trois nombres, et les restrictions réelles du gratuit restent les pages et les sources (la valeur payante). Si l'utilisateur tranche autrement, seule la règle #176 et le rendu changent.
2. **Périodes 30/90 : désactivées ou masquées pour le gratuit ?** *Proposition : désactivées + phrase sobre* (#188) — le comparatif de valeur est visible sans être cliquable, et le modèle est déjà celui de `TarifsSelecteur`. Alternative : ne pas afficher du tout (écran plus épuré, offre moins lisible).
3. **Rétention des agrégats : 180 jours ?** *Proposition : 180 jours* (#174) — au-delà, personne ne regarde un détail quotidien, et les 3 tables grossissent. Si un « historique annuel » est demandé plus tard, la rétention des agrégats sera relevée alors (aucune remigration : seule la constante change).

---

## Hors périmètre (idées notées, pas implémentées)

Graphiques ; export CSV ; page publique de statistiques ; événements métier (clic « Appeler », WhatsApp) ; détail appareil/pays dans l'interface ; seuils d'alerte (« vous avez dépassé X visites ») ; comparaison avec la période précédente ; géoloc IP ; cookie ou identifiant persistant ; purge différée des agrégats par partition ; statistiques au niveau du compte multi-vitrines (une vitrine par compte aujourd'hui).

## Fichiers clés (absolus)

- `/home/cabrel/projects/brandself-app/brandself-app/docs/specs/S11-statistiques.md` (ce document)
- `/home/cabrel/projects/brandself-app/brandself-app/SPRINTS.md` §S11 (brief)
- `/home/cabrel/projects/brandself-app/brandself-app/shared/db/schema.ts`
- `/home/cabrel/projects/brandself-app/brandself-app/server/services/statistiques.ts` (à créer, cœur du sprint)
- `/home/cabrel/projects/brandself-app/brandself-app/server/api/public/[username]/vue.post.ts` (à créer)
- `/home/cabrel/projects/brandself-app/brandself-app/server/api/studio/statistiques/index.get.ts` (à créer)
- `/home/cabrel/projects/brandself-app/brandself-app/app/plugins/suivi-visite.client.ts` (à créer)
- `/home/cabrel/projects/brandself-app/brandself-app/server/config/plans.ts`
- `/home/cabrel/projects/brandself-app/brandself-app/server/services/liens.ts`
- `/home/cabrel/projects/brandself-app/brandself-app/server/services/vitrines.ts`
- `/home/cabrel/projects/brandself-app/brandself-app/server/services/email-outbox.ts`
- `/home/cabrel/projects/brandself-app/brandself-app/worker/index.ts`
