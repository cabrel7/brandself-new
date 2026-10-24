Transforme cet invariant en règle mécanique : $ARGUMENTS
1) GLOBS inclus · GLOBS exclus (- si aucun ; exclure *vendor*/*node_modules*) · REGEX grep -E de la VIOLATION · MESSAGE.
2) Ajoute la ligne dans .claude/guard-rules.tsv (vraies TABULATIONS : printf '%s\t%s\t%s\t%s\n').
3) TESTE : fichier violant + conforme → echo '{"tool_input":{"file_path":"...","content":"..."}}' | bash .claude/hooks/guard-pretool.sh (exit 2 puis 0). Affine si faux positif. Confirme.
