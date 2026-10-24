#!/bin/bash
# SessionStart — (1) cloud: bootstrap outillage ; (2) injecte PROJECT_STATE + tier + outillage.
cat >/dev/null 2>&1
DIR="${CLAUDE_PROJECT_DIR:-$PWD}"; cd "$DIR" 2>/dev/null || exit 0
LOG=""
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -x "$DIR/.claude/scripts/setup-cloud.sh" ]; then
  LOG=$(bash "$DIR/.claude/scripts/setup-cloud.sh" --quick 2>&1 | tail -20)
fi
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -d /opt/pw-browsers ]; then
  { echo "export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers"; echo "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"; } >> "$CLAUDE_ENV_FILE"
fi
# État projet — pas de double injection si le session-start GLOBAL le fait déjà
STATE=""
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || ! { [ -f "$HOME/.claude/settings.json" ] && grep -q 'hooks/session-start.sh' "$HOME/.claude/settings.json" 2>/dev/null; }; then
  [ -f "$DIR/PROJECT_STATE.md" ] && STATE=$(head -c 4000 "$DIR/PROJECT_STATE.md")
fi
TIER=$(grep -E '^tier_(domaine|codebase):' "$DIR/PROJECT_CONTEXT.md" 2>/dev/null | sed 's/[[:space:]]*#.*//' | paste -sd' ' - || true)
ENVK="local"; [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && ENVK="cloud"
CTX="$(basename "$DIR") — session ${ENVK}. ${TIER}"
[ -n "$LOG" ] && CTX="${CTX}
Préparation cloud :
${LOG}"
[ -n "$STATE" ] && CTX="${CTX}

État (PROJECT_STATE.md) :
${STATE}"
CTX="${CTX}

Rappel : protocole v5 (classer trivial/feature, lire le tier, charger le skill avant de coder). Outil manquant = le signaler, ne pas contourner."
jq -cn --arg c "$CTX" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
exit 0
