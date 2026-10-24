---
description: Prépare l'environnement (session cloud ou machine neuve) et affiche l'état de l'outillage
allowed-tools: Bash(bash .claude/scripts/setup-cloud.sh:*)
---
!`bash .claude/scripts/setup-cloud.sh`
Résume en 3 lignes : prêt / manquant / impact. Ne relance pas. Ne lance jamais `playwright install` (Chromium préinstallé en cloud).
