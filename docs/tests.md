# Tests : bases par worker

## Commandes

| Commande | Contenu |
|---|---|
| `pnpm test` | TOUT : unitaires + intégration parallèle + `serie` (migrations, seed). Obligatoire avant le commit d'un sprint. |
| `pnpm test:rapide` | Unitaires + intégration parallèle, SANS les `migration-*` ni le seed. Pour travailler. |
| `pnpm test:migrations` | Projet `serie` seul : `migration-*.test.ts` et `seed-statistiques.test.ts`, en série. |
| `pnpm test:serie` | Secours et comparaison : tout comme avant (un fichier à la fois, base commune, Redis /15). |

`TESTS_WORKERS=<n>` change le nombre de workers d'intégration (défaut 3, maximum 6, constantes dans
`tests/integration/support/bases-par-worker.ts`). Garder le verrou : `flock /tmp/brandself-vitest.lock pnpm test`.

## Conception

- `global-setup.ts` supprime d'abord tout reste d'un run interrompu (`<base>_tpl`, `<base>_w1..6`), crée la base
  modèle `<base>_tpl`, y joue les vraies migrations UNE fois, puis crée `<base>_w<k>` par
  `CREATE DATABASE ... TEMPLATE`. Le teardown supprime modèle et clones (`DROP DATABASE ... WITH (FORCE)`).
- Chaque worker (`VITEST_POOL_ID` = k, de 1 à `maxWorkers`) redirige `DATABASE_URL`, `REDIS_URL` et `MEDIAS_DIR`
  dans `tests/integration/support/isolation-worker.ts`, premier import de `setup.ts`, donc AVANT que
  `server/utils/db.ts` et `redis.ts` (créés à l'import) ne lisent l'environnement. Base `_w<k>`, Redis `/15-k`
  (/14, /13, /12), médias `brandself-tests-medias-w<k>`.
- Garde-fous : la base doit finir par `_test`, `_test_tpl` ou `_test_w<n>` ; Redis seulement /15 ou /15-k.
- Projet `serie` (après le projet parallèle, `sequence.groupOrder`) : les `migration-*` rejouent des migrations sur
  la base commune et le seed (`pnpm db:seed`) écrit dans la base commune par une autre connexion : incompatibles avec
  des clones. Ils gardent la base commune `*_test`, Redis /15 et un dossier de médias à part.
- Autres ressources : le faux K-PAY et le serveur SMTP de test écoutent sur un port éphémère (aucun conflit) ; les
  sous-processus (`scripts.test.ts`, `db:seed`) héritent de l'environnement du worker.
- L'utilisateur PostgreSQL de test doit avoir le droit `CREATEDB` (en CI, `POSTGRES_USER` est superutilisateur).
  Sinon : `pnpm test:serie`.
