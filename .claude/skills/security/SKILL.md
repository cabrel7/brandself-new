---
managed-by: claude-system-v5
name: security
description: Utiliser lors d'un audit de sécurité (/audit) ou pour vérifier qu'une implémentation respecte les standards de sécurité web.
---

# Sécurité — checklist

## Auth & sessions
- [ ] Access token court (15min) + refresh 7j HttpOnly · rotation à chaque usage · invalidation au logout
- [ ] Cookies HttpOnly+Secure+SameSite · rate limit login (5/15min/IP) · bcrypt cost ≥ 12

## Authorization
- [ ] Vérif server-side sur CHAQUE endpoint · IDOR (user n'accède qu'à SES ressources) · least privilege · Policies

## Injection & XSS
- [ ] SQL : prepared/ORM uniquement · XSS : échappement output + CSP · uploads : MIME réel (magic bytes), hors web root
- [ ] Jamais d'input dans exec()/shell_exec()

## Exposition
- [ ] Réponses API sans champs internes · logs sans secrets/PII · zéro credential en dur · .env gitignored

## Transport & headers
- [ ] HTTPS + HSTS · X-Frame-Options SAMEORIGIN · nosniff · CORS explicite (jamais `*` en prod)

## Dépendances
- [ ] `npm audit` / `composer audit` · pas de CVE critique · pas de package abandonné > 2 ans

## Laravel
- [ ] APP_DEBUG=false + APP_ENV=production en prod · CSRF actif · `$fillable` explicite partout
