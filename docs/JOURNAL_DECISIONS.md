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
