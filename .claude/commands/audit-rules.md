Délègue au reviewer : audit du code EXISTANT contre les INVARIANTS du CLAUDE.md + .claude/guard-rules.tsv.
Pour chaque règle TSV : grep -rnE sur les sources (hors node_modules/vendor/dist). Pour chaque invariant sans règle
mécanique : vérifie + PROPOSE la règle grep. Corrige CRITICAL/MAJOR, liste MINOR. Maj PROJECT_STATE.md.
