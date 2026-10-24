#!/bin/bash
# setup-cloud.sh — prépare une session cloud (ou machine neuve). Idempotent. Rien dans ~/.claude.
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"; cd "$DIR" || exit 0
ok(){ echo "✓ $1"; }; warn(){ echo "⚠ $1"; }
SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"; AU=0
apt_i(){ command -v apt-get >/dev/null 2>&1 || return 1; [ $AU -eq 0 ] && { $SUDO apt-get update -y >/dev/null 2>&1 || true; AU=1; }; $SUDO apt-get install -y --no-install-recommends "$@" >/dev/null 2>&1; }
command -v jq >/dev/null 2>&1 && ok jq || { apt_i jq && ok "jq installé" || warn "jq absent (hooks inactifs)"; }
command -v ffmpeg >/dev/null 2>&1 && ok ffmpeg || { apt_i ffmpeg && ok "ffmpeg installé" || warn "ffmpeg absent"; }
[ -d /opt/pw-browsers ] && ok "chromium préinstallé (NE PAS lancer playwright install)" || { [ -d "$HOME/.cache/ms-playwright" ] && ok chromium || warn "chromium absent (local: pnpm exec playwright install chromium)"; }
# Node + gestionnaire de paquets
if command -v node >/dev/null 2>&1; then ok "node $(node -v)"
  if [ -f pnpm-lock.yaml ]; then command -v pnpm >/dev/null 2>&1 || { PMV=$(command -v jq >/dev/null 2>&1 && jq -r '.packageManager // empty' package.json 2>/dev/null); corepack enable >/dev/null 2>&1 || npm i -g "${PMV:-pnpm}" >/dev/null 2>&1; }
    command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm -v)" || warn "pnpm non installable"; fi
else warn "node absent"; fi


# Dépendances
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  { [ ! -d node_modules ] || [ $QUICK -eq 0 ]; } && { pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install" || warn "pnpm install en échec"; } || ok "node_modules présent"
elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
  [ ! -d node_modules ] && { npm ci >/dev/null 2>&1 && ok "npm ci" || warn "npm ci en échec"; } || ok "node_modules présent"
fi

exit 0
