---
managed-by: claude-system-v5
description: Analyse ISSUES.log (projet + global) et propose des guard-rules et améliorations de skills, à valider
---
Analyse manuelle de la boucle d'apprentissage (en plus de la finale automatique de /feature).

1. Lis `ISSUES.log` du projet et `~/.claude/global-issues.log` s'il existe.
2. Regroupe par pattern. Classe : projet-spécifique → guard-rule du projet · pattern stack (2+ projets)
   → skill global · pattern universel → CLAUDE.md global.
3. PRÉSENTE les propositions INLINE : « [1] … [2] … applique : [1][2][tout][aucun] ? ».
4. Pour une guard-rule : génère la règle, TESTE-la (fichier violant + conforme) avant de l'activer.
   Pour un skill/CLAUDE.md global : montre le diff, BACKUP avant d'écrire, applique sur confirmation.
N'écris rien sans le choix de l'utilisateur.
