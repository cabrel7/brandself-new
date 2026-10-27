# Journal des décisions (session autonome)

Décisions prises sans l'utilisateur, à relire au retour. Format : date · décision · raison · réversibilité.

- 2026-10-26 · S2 : décisions #16–22 de docs/specs/S2-backend.md appliquées par défaut (upload synchrone, publication sans photo, 30 pays, devises XAF/EUR/USD, accroche 160 / bio 2000) · valeurs par défaut de la spec · modifiable dans shared/.
- 2026-10-26 · Onboarding sans ville/pays : non ajouté, « C'est en ligne » inatteignable jusqu'à S8 · décision produit non tranchée · à trancher.
- 2026-10-26 · Case « Afficher le formulaire de contact » absente · aucun champ DTO · à trancher.
- 2026-10-26 · DB `brandself_dev` désynchronisée : NON recréée (perte de données locales) · attend l'accord.
- 2026-10-26 · Processus dev/worker orphelins : arrêtés sur accord de l'utilisateur (Postgres/Redis non touchés).
- 2026-10-26 · S2 L3 : `hitLimit` fail-open si Redis tombe (journal écrit) · limites anti-abus, pas anti-fraude · inverser = fail-closed 503.
- 2026-10-26 · S2 L3 : PUT /vitrine sur vitrine publiée rendue incomplète → 422 PUBLICATION_INCOMPLETE (évite « à  » en SEO).
- 2026-10-26 · S2 : testTimeout 30 s sur projet unit (import à froid drizzle/sharp ~6 s).
- 2026-10-26 · S2 : suppression de compte ne purge pas les clés Redis OTP (expirent seules).
- 2026-10-26 · S2 validé : build OK (nécessite RESEND_API_KEY en prod), e2e 97/97, captures comparées. Bug corrigé : emailOTP rateLimit 1/min/IP bloquait les connexions derrière un même réseau → customRules 30/min.
- 2026-10-26 · S2 écarts maquette NON traités (hors périmètre ou à trancher) : auto-enregistrement Profil, bouton « Améliorer avec l'IA » (S8), switch formulaire de contact, accroche 160 vs 90 car., poids des titres (gras vs moyen), `/studio/**` à passer noindex, `site.defaultLocale: fr`, vitrine publique sans sections services/réalisations (arrivent en S3/S4).
- 2026-10-26 · Playwright lance `pnpm dev` (démarrage 4 min sur cette machine) : idée d'utiliser le build + E2E_BASE_URL, non faite.
- 2026-10-26 · S2 : routes S3–S6 laissées cassées volontairement jusqu'à leur sprint.
- 2026-10-26 · S3 : décisions #23–45 de docs/specs/S3-services.md appliquées par défaut (slug immuable, masquer retire la vedette, 4e vedette → 409, prix XAF en code, devis ⇒ tarif devis, rythmes fermés, paiement en ligne désactivé, bouton d'action → /[username]/reserver provisoire jusqu'à S7, glisser-déposer via vueuse+sortablejs, slugify @sindresorhus). Prix du seed = valeurs de travail à valider par Cabrel.
- 2026-10-26 · S3 : PAIEMENT_EN_LIGNE vide = absent ; .env.example à compléter par Cabrel (PAIEMENT_EN_LIGNE=false, accès refusé aux agents) ; réordonnancement en POST /api/studio/services/reordonner ; drapeau paiement lu par env (API) et runtimeConfig (front) : même variable, risque de divergence en prod.
- 2026-10-26 · S3 correctifs UX : token --accent-texte (≥5,57:1 sur les 5 palettes), poignée de tri en fin de ligne (écart maquette+spec, à valider), badge « En vedette » stylé en local (pas app.config). Entorse : un agent a utilisé sed sur 2 fichiers (règle §6.3), résultat vérifié lint+typecheck. h1 studio hors services encore en semibold (incohérence à traiter en revue design globale).
- 2026-10-27 · S3 validé : build OK (16 min), e2e 162/162, captures comparées. Bug prod corrigé : rate limit Better Auth 100/min/IP sur /get-session → page d'incident derrière CGNAT ; règle désactivée pour ce chemin (lecture seule).
- 2026-10-27 · S3 écarts maquette NON traités : poignée de tri (spec) absente de la maquette, « Enregistrer » grisé sans modification, astérisques et compteur de caractères ajoutés, bouton Ajouter 56 px vs 44, avatar « C » mobile, CTA « Me contacter » vs « Réserver » (S7), glisser souris/tactile non testé en e2e.
- 2026-10-27 · S4 : décisions #46–67 de docs/specs/S4-realisations.md appliquées par défaut (galerie 6 images max, image principale obligatoire, 1 vedette effective sur l'accueil selon spec, année pré-remplie, galerie sans visionneuse, seed sans rôles/URL inventés, textes de formulaire neutres, bandeau vers /reserver provisoire). Pages « Page Réalisations » et « Réalisation · PC » sans maquette : dérivées de Services. À valider par Cabrel.
