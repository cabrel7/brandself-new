#!/bin/bash
# PreToolUse — bloque une écriture violant .claude/guard-rules.tsv (exit 2).
# Auto-retrait : si le hook GLOBAL est présent ET ENREGISTRÉ dans settings.json, et qu'on n'est PAS en cloud.
[ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ -f "$HOME/.claude/hooks/guard-pretool.sh" ] && grep -q 'guard-pretool.sh' "$HOME/.claude/settings.json" 2>/dev/null && exit 0
INPUT=$(cat); FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty'); [ -z "$FILE" ] && exit 0
CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty'); [ -z "$CONTENT" ] && exit 0
RULES="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/guard-rules.tsv"; [ -f "$RULES" ] || exit 0
TMP=$(mktemp); printf '%s' "$CONTENT" > "$TMP"; VIOL=""
while IFS=$'\t' read -r globs excludes regex msg; do
  case "$globs" in ''|'#'*) continue ;; esac; [ -z "$regex" ] && continue
  m=0; IFS=',' read -ra GL <<< "$globs"; for g in "${GL[@]}"; do g=$(echo "$g"|xargs); case "$FILE" in $g) m=1;break;; esac; done
  [ "$m" -eq 0 ] && continue
  if [ -n "$excludes" ] && [ "$excludes" != "-" ]; then s=0; IFS=',' read -ra EX <<< "$excludes"; for e in "${EX[@]}"; do e=$(echo "$e"|xargs); case "$FILE" in $e) s=1;break;; esac; done; [ "$s" -eq 1 ] && continue; fi
  grep -nE "$regex" "$TMP" >/dev/null 2>&1 && VIOL="${VIOL}
[${msg}] lignes: $(grep -nE "$regex" "$TMP"|cut -d: -f1|paste -sd, -)"
done < "$RULES"; rm -f "$TMP"
[ -n "$VIOL" ] && { echo "BLOQUÉ — violations dans $FILE. Corrige AVANT d'écrire :$VIOL" >&2; exit 2; }; exit 0
