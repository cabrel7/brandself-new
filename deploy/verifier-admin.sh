#!/bin/bash
# A1 (spec §5, CA02-CA04, CA22) : vérification de l'isolation de l'hôte d'administration.
#
# Usage : ./deploy/verifier-admin.sh <url-publique> <url-admin> [autorisee|externe]
#   ./deploy/verifier-admin.sh https://jesuis.pro https://admin.jesuis.pro autorisee   # depuis une IP DE la liste
#   ./deploy/verifier-admin.sh https://jesuis.pro https://admin.jesuis.pro externe     # depuis une IP HORS liste
#
# Les deux passages sont nécessaires : un seul ne prouve pas tout.
#   - autorisee : contrôle l'allow-list de chemins (404), les en-têtes et les cookies.
#   - externe   : contrôle que le refus d'IP répond 403 partout (chemins applicatifs, `/`, inconnus).
# Aucun secret ni cookie n'est envoyé : uniquement des requêtes anonymes. Code de sortie non nul
# au premier échec.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage : $0 <url-publique> <url-admin> [autorisee|externe]" >&2
  exit 2
fi

PUBLIC="${1%/}"
ADMIN="${2%/}"
MODE="${3:-autorisee}"

case "$PUBLIC" in https://*) ;; *) echo "L'URL publique doit commencer par https://" >&2; exit 2 ;; esac
case "$ADMIN" in https://*) ;; *) echo "L'URL admin doit commencer par https://" >&2; exit 2 ;; esac
case "$MODE" in autorisee | externe) ;; *) echo "Mode inconnu : $MODE (autorisee ou externe)" >&2; exit 2 ;; esac

CURL_OPTS=(-s --connect-timeout 5 --max-time 15)
ADMIN_HOTE="${ADMIN#https://}"

echo "=== Vérification de l'administration (mode : $MODE) ==="

echec() {
  echo "ECHEC : $1" >&2
  exit 1
}

# Code HTTP d'une requête sans suivre les redirections. Arguments : méthode puis URL.
code() {
  curl "${CURL_OPTS[@]}" -o /dev/null -w '%{http_code}' -X "$1" "$2"
}

# En-têtes complets d'une requête GET (pas HEAD : certaines routes ne répondent pas à HEAD).
entetes() {
  curl "${CURL_OPTS[@]}" -o /dev/null -D - "$1" | tr -d '\r'
}

attendre_code() {
  # attendre_code <code attendu> <méthode> <url>
  local obtenu
  obtenu="$(code "$2" "$3")"
  if [ "$obtenu" != "$1" ]; then
    echec "$2 $3 : $obtenu (attendu $1)"
  fi
  echo "OK    $2 $3 -> $obtenu"
}

# --- Hôte public : l'administration n'y existe pas (CA02, CA04). Valable dans les deux modes. ---
attendre_code 404 GET "$PUBLIC/api/admin/session"
attendre_code 404 GET "$PUBLIC/admin"
attendre_code 404 GET "$PUBLIC/admin/connexion"
attendre_code 404 POST "$PUBLIC/api/auth/admin/set-role"
attendre_code 404 POST "$PUBLIC/api/auth/admin/impersonate-user"

# --- HTTP sur le port 80 : redirection, jamais de contenu en clair, jamais de 403. ---
HTTP_CODE="$(code GET "http://$ADMIN_HOTE/admin")"
if [ "$HTTP_CODE" != "301" ]; then
  echec "http://$ADMIN_HOTE/admin : $HTTP_CODE (attendu 301 vers HTTPS)"
fi
echo "OK    http://$ADMIN_HOTE/admin -> 301"

if [ "$MODE" = "externe" ]; then
  # Depuis une IP hors liste : 403 partout, y compris là où Nginx répondrait 302 (`/`) ou 404 (chemins
  # inconnus, plugin admin) : le `if` du niveau serveur passe avant toute location. Un autre code = fuite.
  attendre_code 403 GET "$ADMIN/admin"
  attendre_code 403 GET "$ADMIN/api/admin/session"
  attendre_code 403 GET "$ADMIN/studio"
  attendre_code 403 GET "$ADMIN/"
  attendre_code 403 GET "$ADMIN/chemin-inconnu"
  attendre_code 403 GET "$ADMIN/sw.js"
  attendre_code 403 POST "$ADMIN/api/auth/admin/set-role"
  echo ""
  echo "=== Vérification terminée (IP hors liste : 403 partout) ==="
  exit 0
fi

# --- Hôte admin depuis une IP autorisée : liste blanche de chemins (CA03). ---
attendre_code 404 GET "$ADMIN/studio"
attendre_code 404 GET "$ADMIN/sw.js"
attendre_code 404 GET "$ADMIN/manifest.json"
attendre_code 404 GET "$ADMIN/mcp"
attendre_code 404 GET "$ADMIN/robots.txt"
attendre_code 404 GET "$ADMIN/sitemap.xml"
attendre_code 404 GET "$ADMIN/dr-cabrel"
attendre_code 404 GET "$ADMIN/api/studio/moi"
attendre_code 404 GET "$ADMIN/.well-known/openid-configuration"
# Plugin admin de Better Auth (CA04) : 404 sur l'hôte admin aussi (même sans barre finale).
attendre_code 404 POST "$ADMIN/api/auth/admin/set-role"
attendre_code 404 POST "$ADMIN/api/auth/admin/impersonate-user"
attendre_code 404 GET "$ADMIN/api/auth/admin"

# `/` redirige vers /admin.
RACINE_CODE="$(code GET "$ADMIN/")"
if [ "$RACINE_CODE" != "302" ]; then
  echec "$ADMIN/ : $RACINE_CODE (attendu 302)"
fi
echo "OK    GET $ADMIN/ -> 302"

# --- En-têtes et cookies sur les chemins servis (CA22). ---
for chemin in /admin /admin/connexion /api/admin/session /api/auth/get-session; do
  ENTETES="$(entetes "$ADMIN$chemin")"

  if ! printf '%s\n' "$ENTETES" | grep -iq '^x-robots-tag:.*noindex'; then
    echec "$chemin : X-Robots-Tag noindex absent"
  fi
  if ! printf '%s\n' "$ENTETES" | grep -iq '^cache-control:.*no-store'; then
    echec "$chemin : Cache-Control no-store absent"
  fi
  if ! printf '%s\n' "$ENTETES" | grep -iq '^x-frame-options: *deny'; then
    echec "$chemin : X-Frame-Options DENY absent"
  fi
  if printf '%s\n' "$ENTETES" | grep -iq '^x-cache-status:'; then
    echec "$chemin : X-Cache-Status présent (la réponse admin ne doit jamais passer par un cache)"
  fi
  # Cookies host-only (D-A1-07) : jamais d'attribut Domain.
  if printf '%s\n' "$ENTETES" | grep -i '^set-cookie:' | grep -iq 'domain='; then
    echec "$chemin : un Set-Cookie contient Domain= (le cookie doit rester propre à l'hôte)"
  fi
  echo "OK    $chemin : noindex, no-store, DENY, pas de cache, pas de Domain="
done

echo ""
echo "=== Vérification terminée ==="
echo "Relancer depuis une IP hors liste : $0 $PUBLIC $ADMIN externe"
