#!/bin/bash
# SubagentStop — relance UNIQUEMENT les tests du périmètre modifié (frontend/backend/database).
# Anti "vert menteur" : un test SAUTÉ n'est PAS réussi (bloque si skipped>0). Vérifie les migrations.
# Anti-boucle : au 2ᵉ passage (stop_hook_active) on n'arrête plus, on signale.
# Auto-retrait si le gate GLOBAL est présent ET ENREGISTRÉ, et qu'on n'est pas en cloud.
[ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ -f "$HOME/.claude/hooks/subagent-test-gate.sh" ] && grep -q 'subagent-test-gate.sh' "$HOME/.claude/settings.json" 2>/dev/null && exit 0
INPUT=$(cat)
AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_type // .subagent_type // empty')
LOOP=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')
case "$AGENT" in frontend|backend|database) ;; *) exit 0 ;; esac
DIR="${CLAUDE_PROJECT_DIR:-$PWD}"; cd "$DIR" 2>/dev/null || exit 0; command -v git >/dev/null 2>&1 || exit 0
CHANGED=$( { git diff --name-only 2>/dev/null; git diff --name-only --staged 2>/dev/null; } | sort -u ); [ -z "$CHANGED" ] && exit 0
[ -x node_modules/.bin/biome ] && { node_modules/.bin/biome check --no-errors-on-unmatched $CHANGED >/dev/null 2>&1 || true; }
FAIL=""; SKIPS=""
strip(){ sed 's/\x1b\[[0-9;]*m//g'; }

# ── JS/TS : vitest related PAR PAQUET modifié (jamais toute la suite du monorepo) ──
JSF=$(printf '%s\n' "$CHANGED" | grep -E '\.(ts|tsx|js|jsx|vue)$' || true)
if [ -n "$JSF" ]; then
  PAIRS=""
  for f in $JSF; do
    d=$(dirname "$f")
    while [ "$d" != "." ] && [ "$d" != "/" ] && [ ! -f "$d/package.json" ]; do d=$(dirname "$d"); done
    [ -f "$d/package.json" ] || d="."
    if [ "$d" = "." ]; then PAIRS="${PAIRS}.::${f}"$'\n'; else PAIRS="${PAIRS}${d}::${f#$d/}"$'\n'; fi
  done
  for pd in $(printf '%s' "$PAIRS" | sed 's/::.*//' | sort -u); do
    REL=""; while IFS= read -r pr; do [ -z "$pr" ] && continue; [ "${pr%%::*}" = "$pd" ] && REL="$REL ${pr#*::}"; done <<< "$PAIRS"
    [ -z "$REL" ] && continue
    OUT=$( cd "$pd" 2>/dev/null && { if [ -x node_modules/.bin/vitest ]; then node_modules/.bin/vitest related --run --passWithNoTests $REL; \
      elif command -v pnpm >/dev/null 2>&1; then pnpm exec vitest related --run --passWithNoTests $REL; else exit 0; fi; } 2>&1 ) \
      || FAIL="${FAIL}
=== VITEST $pd (échec) ===
$(printf '%s' "$OUT"|strip|tail -25)"
    SK=$(printf '%s' "$OUT" | strip | grep -E '^[[:space:]]*Tests[[:space:]]' | grep -oE '[0-9]+ skipped' | grep -oE '[0-9]+' | tail -1)
    [ -n "$SK" ] && [ "$SK" -gt 0 ] && SKIPS="$SKIPS ${pd}:${SK}"
  done
fi

# ── PHP : Pest/PHPUnit sur le périmètre ──
if printf '%s\n' "$CHANGED" | grep -qE '\.php$'; then
  if [ -x backend/vendor/bin/pest ]; then OUT=$( cd backend && vendor/bin/pest --compact 2>&1 ) || FAIL="${FAIL}
=== PEST (échec) ===
$(printf '%s' "$OUT"|strip|tail -25)"; fi
fi

# ── Migrations (agent database, ou fichier de migration touché) ──
if [ "$AGENT" = "database" ] || printf '%s\n' "$CHANGED" | grep -qiE '(migrat|/db/|\.sql$|schema\.(ts|prisma))'; then
  for m in $(printf '%s\n' "$CHANGED" | grep -E '\.sql$' || true); do
    [ -f "$m" ] || continue
    grep -q '^-- migrate:up'   "$m" 2>/dev/null || FAIL="${FAIL}
=== MIGRATION $m : '-- migrate:up' manquant ==="
    grep -q '^-- migrate:down' "$m" 2>/dev/null || FAIL="${FAIL}
=== MIGRATION $m : '-- migrate:down' manquant (migration NON réversible) ==="
    command -v squawk >/dev/null 2>&1 && { OUT=$(squawk "$m" 2>&1) || FAIL="${FAIL}
=== SQUAWK $m ===
$(printf '%s' "$OUT"|strip|tail -15)"; }
  done
  if [ -n "${DATABASE_URL:-}" ] && command -v dbmate >/dev/null 2>&1; then
    OUT=$(dbmate up 2>&1 && dbmate down 2>&1 && dbmate up 2>&1) || FAIL="${FAIL}
=== DBMATE up→down→up (réversibilité non prouvée) ===
$(printf '%s' "$OUT"|strip|tail -20)"
  fi
fi

# ── Verdict ──
[ -n "$SKIPS" ] && FAIL="${FAIL}
=== TESTS SAUTÉS (un test sauté n'est PAS réussi) :$SKIPS ==="
if [ -n "$FAIL" ]; then
  if [ "$LOOP" = "true" ]; then
    jq -cn --arg m "Gate : échec PERSISTANT après une 1ʳᵉ correction — je n'arrête plus la boucle, à toi de trancher.$(printf '%s' "$FAIL"|tail -c 2500)" '{systemMessage:$m}'
  else
    jq -cn --arg r "Périmètre en ÉCHEC — ne marque pas terminé, corrige puis relance.$(printf '%s' "$FAIL"|tail -c 3000)" '{decision:"block",reason:$r}'
  fi
fi
exit 0
