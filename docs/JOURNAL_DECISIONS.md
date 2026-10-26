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
- 2026-10-26 · S2 : routes S3–S6 laissées cassées volontairement jusqu'à leur sprint.
