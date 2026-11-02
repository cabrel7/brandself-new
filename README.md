# Brandself

Vitrine en ligne pour professionnels : être trouvé sur Google, être compris, être contacté ou réservé. Nuxt fullstack, PostgreSQL, Redis. Voir `PROJECT_CONTEXT.md` pour le produit.

## Installation locale (5 commandes)

```bash
pnpm install                      # 1. dépendances
cp .env.example .env              # 2. configuration (adapter DATABASE_URL si besoin)
docker compose up -d              # 3. PostgreSQL + Redis + Mailpit (ou services natifs)
pnpm db:migrate                   # 4. migrations (active btree_gist)
pnpm dev                          # 5. application sur http://localhost:3000
```

Dans un autre terminal, le worker de jobs :

```bash
pnpm worker
```

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | application (Nuxt/Nitro) |
| `pnpm worker` | process de jobs BullMQ (séparé) |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | qualité |
| `pnpm e2e` | Playwright |
| `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` | base de données (Drizzle) |
| `pnpm jobs:ping` | ajoute un job `ping` de test dans la file |
| `pnpm build` · `pnpm preview` | production |

## Services

- **PostgreSQL** : `docker compose up -d postgres` — sinon un serveur natif convient, adapter `DATABASE_URL` dans `.env`.
- **Redis** : `docker compose up -d redis` — sinon natif (`redis-server`).
- **Mailpit** (courriels de test) : `docker compose up -d mailpit` — interface sur http://localhost:8025.

## Notes

- La configuration vit dans `.env` (jamais commité) et est **validée par Zod au démarrage** : une variable manquante fait échouer le lancement avec un message clair (`shared/env.ts` est le seul fichier qui lit `process.env`).
- La structure et les règles : `CLAUDE.md`. Le produit : `PROJECT_CONTEXT.md`. L'avancement : `PROJECT_STATE.md`. Les sprints : `SPRINTS.md`.

## Production

### Source des variables

- PM2 (`ecosystem.config.cjs`) lance l'application et le worker avec `node --env-file=.env` : les variables viennent du fichier `.env` placé à la racine du déploiement (`chmod 600`, jamais commité, hors dépôt de sauvegarde publique).
- `NODE_ENV=production` est fixé par PM2 ; en production `RESEND_API_KEY` devient obligatoire (validation Zod au démarrage, `shared/env.ts`).
- Après modification de `.env` : `pm2 reload ecosystem.config.cjs --update-env`, puis `pm2 logs` pour vérifier l'absence d'erreur de configuration.
- Le worker est un process unique (`instances: 1`) : ne jamais le passer en cluster, les tâches planifiées ne doivent avoir qu'un seul runner.

### Reverse proxy Nginx

Nitro écoute uniquement sur l'interface loopback `127.0.0.1:3000`. Le port `3000` ne doit pas être exposé publiquement ni ouvert dans le pare-feu.

Le snippet `deploy/nginx/brandself-location.conf` fournit le `location /` à inclure dans le bloc `server` HTTPS de Nginx. Avant tout rechargement, valider la configuration et ne poursuivre que si le test réussit :

```bash
sudo nginx -t
sudo systemctl reload nginx
```
