#!/bin/bash
# Vérification, sur le VPS, de l'éviction du cache nginx des images d'une vitrine masquée.
# Usage : MEDIAS_CACHE_REFRESH_SECRET=<secret> ./deploy/verifier-cache-medias.sh <URL d'une image publique d'un compte de test>
#   ex. : ./deploy/verifier-cache-medias.sh https://jesuis.pro/medias/<chemin-de-la-variante>
# Le secret est lu dans l'environnement, sinon demandé sans écho. Il n'est jamais passé en argument
# de commande (visible dans `ps`) : il est écrit dans un fichier temporaire 600 lu par curl.
# L'étape de suspension est MANUELLE (le script s'arrête et attend). Utiliser un compte de test.
set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" || "$URL" != https://* ]]; then
  echo "Usage : $0 <URL https d'une image publique d'un compte de test>" >&2
  exit 2
fi

SECRET="${MEDIAS_CACHE_REFRESH_SECRET:-}"
if [[ -z "$SECRET" ]]; then
  read -rsp "Secret de rafraîchissement (MEDIAS_CACHE_REFRESH_SECRET) : " SECRET
  echo
fi
if [[ -z "$SECRET" || "$SECRET" == "CHANGER-MOI" ]]; then
  echo "ÉCHEC : secret vide ou marqueur d'exemple CHANGER-MOI." >&2
  exit 2
fi

TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
umask 077
printf 'X-Cache-Refresh: %s\n' "$SECRET" > "$TMP/bon.hdr"
printf 'X-Cache-Refresh: mauvais-%s-%s\n' "$RANDOM" "$RANDOM" > "$TMP/mauvais.hdr"

# fetch <nom> [fichier-en-tête] : renseigne CODE, CACHE, CCTRL (en-têtes en minuscules sur la réponse).
fetch() {
  local out="$TMP/$1.out"; local extra=()
  [[ -n "${2:-}" ]] && extra=(-H "@$2")
  curl -sS --max-time 20 -o /dev/null -D "$out" "${extra[@]}" "$URL"
  CODE="$(awk 'NR==1 {print $2}' "$out" | tr -d '\r')"
  CACHE="$(grep -i '^x-cache-status:' "$out" | head -1 | cut -d: -f2- | tr -d ' \r' | tr 'a-z' 'A-Z' || true)"
  CCTRL="$(grep -i '^cache-control:' "$out" | cut -d: -f2- | tr -d '\r' | tr 'A-Z' 'a-z' || true)"
}

FAILS=0
check() { # check <libellé> <condition 0/1 via code retour> <détail>
  if [[ "$2" == "0" ]]; then echo "OK     $1  ($3)"; else echo "ÉCHEC  $1  ($3)"; FAILS=$((FAILS + 1)); fi
}

echo "=== Cache nginx des médias : $URL ==="

# (i) 200 puis HIT
fetch r1
check "(i-a) 1re requête : 200" "$([[ "$CODE" == "200" ]] && echo 0 || echo 1)" "code=$CODE cache=$CACHE"
fetch r2
check "(i-b) 2e requête : HIT" "$([[ "$CODE" == "200" && "$CACHE" == "HIT" ]] && echo 0 || echo 1)" "code=$CODE cache=$CACHE"

# (iv) un MAUVAIS secret ne bypasse pas (avant suspension : doit rester un HIT)
fetch r3 "$TMP/mauvais.hdr"
check "(iv) mauvais secret : pas de BYPASS" "$([[ "$CODE" == "200" && "$CACHE" == "HIT" ]] && echo 0 || echo 1)" "code=$CODE cache=$CACHE"

echo
echo "ÉTAPE MANUELLE : suspendre maintenant le compte de test (ou bloquer sa vitrine) depuis l'administration."
read -rp "Appuyer sur Entrée une fois fait... " _ < /dev/tty

# Info : la tâche de fond a peut-être déjà expulsé l'ancien 200 (c'est son rôle).
sleep 3
fetch r4
echo "INFO   requête normale juste après la suspension : code=$CODE cache=$CACHE (404 = la tâche de fond a déjà expulsé l'ancien 200)"

# (ii) rafraîchissement avec le bon secret : BYPASS et 404
fetch r5 "$TMP/bon.hdr"
check "(ii) bon secret : 404 et BYPASS" "$([[ "$CODE" == "404" && "$CACHE" == "BYPASS" ]] && echo 0 || echo 1)" "code=$CODE cache=$CACHE"

# (iii) requête normale suivante : 404 (l'ancien 200 est expulsé), servi par le cache
fetch r6
check "(iii) requête normale : 404 (ancien 200 expulsé)" "$([[ "$CODE" == "404" ]] && echo 0 || echo 1)" "code=$CODE cache=$CACHE"

# (v) le 404 n'est ni public ni immutable
BAD=0; [[ "$CCTRL" == *immutable* || "$CCTRL" == *public* ]] && BAD=1
check "(v) 404 sans public ni immutable" "$BAD" "cache-control=${CCTRL:-<absent>}"

echo
if [[ "$FAILS" -eq 0 ]]; then echo "=== TOUT EST OK ==="; else echo "=== $FAILS ÉCHEC(S) ==="; exit 1; fi
echo "Penser à lever la suspension du compte de test (l'image doit redevenir 200 après le rafraîchissement par la tâche de fond)."
