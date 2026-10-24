---
managed-by: claude-system-v5
name: nginx
description: Utiliser quand tu configures Nginx, génères des server blocks, configures SSL/Certbot, ou prépares un déploiement sur VPS Ubuntu.
---

# Nginx + Ubuntu + SSL/Certbot

## Redirect HTTP→HTTPS
```nginx
server { listen 80; server_name example.com www.example.com; return 301 https://$host$request_uri; }
```

## Bloc HTTPS
```nginx
server {
  listen 443 ssl http2; server_name example.com;
  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
  add_header X-Frame-Options SAMEORIGIN always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  gzip on; gzip_types text/css application/json application/javascript image/svg+xml;
  server_tokens off; client_max_body_size 20M;
  access_log /var/log/nginx/example.access.log; error_log /var/log/nginx/example.error.log warn;
}
```

## Proxy API
```nginx
location /api { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }
```

## SPA
```nginx
location / { try_files $uri $uri/ /index.html; }
location ~* \.(js|css|png|jpg|svg|woff2)$ { expires 1y; add_header Cache-Control "public, immutable"; }
```

## Certbot & workflow
```bash
sudo certbot --nginx -d example.com -d www.example.com
sudo nginx -t && sudo systemctl reload nginx    # reload, jamais restart (zero-downtime)
```
Règle : `nginx -t` OBLIGATOIRE avant tout reload · server_tokens off toujours.

## Déploiement app Node (Nuxt/Nitro, Next.js) sur VPS
```bash
# Build : node .output/server/index.mjs (Nitro) — servi derrière le reverse proxy
pm2 start .output/server/index.mjs -i max --name app   # cluster = tous les cœurs + restart auto
pm2 reload app                                          # zero-downtime
# Déploiement ordonné : pull → install → build → migrate → reload
git pull && npm ci && npm run build && npx prisma migrate deploy && pm2 reload app
```
- Proxy : `proxy_pass http://127.0.0.1:3000;` (port Nitro). Caddy = HTTPS auto (Let's Encrypt), sinon Nginx+certbot.
- ⚠️ Cluster PM2 : les tâches planifiées se déclinent par worker → 1 seul runner (cron externe ou process `-i 1`).
- `prisma migrate deploy` (jamais `dev`) AVANT le reload · endpoint `/api/health` pour le monitoring.
- Backups Postgres automatisés (`pg_dump` cron + hors-site) — obligatoire pour données sensibles.
