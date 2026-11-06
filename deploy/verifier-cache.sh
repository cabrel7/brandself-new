#!/bin/bash
# S12 (#138, CA32, CA33) : vérification du microcache nginx sur la préproduction.
# Usage : ./deploy/verifier-cache.sh https://preprod.brandself.io
set -euo pipefail

SITE="${1:-https://preprod.brandself.io}"
PAGE="$SITE/dr-cabrel"

echo "=== Vérification du microcache nginx ==="

# 1. Première requête : doit être un MISS
echo -n "Requête 1 (sans cookie) : "
CODE1=$(curl -s -o /dev/null -w "%{http_code}" -D - "$PAGE" | grep -i "x-cache-status" || true)
CACHE1=$(curl -s -D - "$PAGE" | grep -i "x-cache-status" | head -1)
echo "$CACHE1"

# 2. Deuxième requête : doit être un HIT (même page, même conditions)
sleep 1
echo -n "Requête 2 (sans cookie) : "
CACHE2=$(curl -s -D - "$PAGE" | grep -i "x-cache-status" | head -1)
echo "$CACHE2"

# 3. Requête avec cookie de session : doit être un BYPASS
echo -n "Requête 3 (avec cookie session_token) : "
CACHE3=$(curl -s -D - -H "Cookie: session_token=fake" "$PAGE" | grep -i "x-cache-status" | head -1)
echo "$CACHE3"

# 4. Page de confirmation : jamais en cache (private, no-store)
echo -n "Page de confirmation : "
CACHE4=$(curl -s -D - "$SITE/dr-cabrel/reserver/confirmation?jeton=test" | grep -i "x-cache-status\|cache-control" | head -1)
echo "$CACHE4"

# 5. Requête avec query string : la clé de cache ignore la query
echo -n "Requête avec marqueur de query : "
curl -s -o /dev/null "$PAGE?marqueur=test123"
CACHE5=$(curl -s -D - "$PAGE" | grep -i "x-cache-status" | head -1)
echo "$CACHE5"

echo ""
echo "=== Vérification terminée ==="
echo "Attendu : MISS puis HIT sur les requêtes 1 et 2, BYPASS avec cookie, pas de HIT sur la confirmation."
echo "La query string ne doit pas polluer le cache (requête 5 = même statut que requête 2)."
