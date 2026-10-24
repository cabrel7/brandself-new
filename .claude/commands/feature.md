---
managed-by: claude-system-v5
description: Orchestration explicite d'une feature de bout en bout (le même protocole s'applique de toute façon par défaut)
---
Implémente de bout en bout : $ARGUMENTS

Applique le PROTOCOLE ORCHESTRATION V5 du CLAUDE.md global :
1. Classe (trivial → direct). Lis le tier (PROJECT_CONTEXT). Auto-escalation si auth/paiement/PII.
2. architect → spec + critères d'acceptation Given/When/Then (+ contract/types si API, tier standard+).
3. Backend/logique = TDD (tester RED → backend GREEN → refactor, max 3 cycles sinon escalade architect).
   Frontend/UI = injection d'exemples existants + contract + implémentation + tests composant + ux-reviewer.
4. regression-checker (impact existant) + reviewer SUR DIFF + e2e (tier standard+).
5. Finale : mesure temps/tokens par phase + boucle d'apprentissage inline (propositions, tu choisis).
Mets à jour PROJECT_STATE.md. Livrable : fichiers + sortie brute des tests + résumé 3 lignes.
