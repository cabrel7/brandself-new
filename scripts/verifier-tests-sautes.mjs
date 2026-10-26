#!/usr/bin/env node
// Échoue si le rapport JSON de Vitest contient un test sauté (skip), à faire (todo) ou désactivé.
// Un test sauté n'est pas un test réussi : le gate de CI le refuse.
//
// Usage : node scripts/verifier-tests-sautes.mjs [chemin-du-rapport]
// Rapport produit par : vitest run --reporter=default --reporter=json --outputFile=test-results/vitest.json

import { existsSync, readFileSync } from 'node:fs'

const CHEMIN_PAR_DEFAUT = 'test-results/vitest.json'
const STATUTS_NON_EXECUTES = new Set(['pending', 'skipped', 'todo', 'disabled'])

const chemin = process.argv[2] ?? CHEMIN_PAR_DEFAUT

if (!existsSync(chemin)) {
  console.error(`Rapport Vitest introuvable : ${chemin}. Lancez d'abord vitest avec --reporter=json --outputFile=${chemin}.`)
  process.exit(2)
}

let rapport
try {
  rapport = JSON.parse(readFileSync(chemin, 'utf-8'))
} catch (erreur) {
  console.error(`Rapport Vitest illisible (${chemin}) : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
  process.exit(2)
}

const fichiers = Array.isArray(rapport.testResults) ? rapport.testResults : []
const nonExecutes = []
let total = 0

for (const fichier of fichiers) {
  for (const test of fichier.assertionResults ?? []) {
    total += 1
    if (STATUTS_NON_EXECUTES.has(test.status)) {
      nonExecutes.push(`${fichier.name} > ${test.fullName ?? test.title} [${test.status}]`)
    }
  }
}

// Les compteurs globaux du rapport sont recoupés avec le détail : on ne se fie à aucun des deux seuls.
const pending = Number(rapport.numPendingTests ?? 0)
const todo = Number(rapport.numTodoTests ?? 0)

if (total === 0) {
  console.error('Aucun test dans le rapport : une suite vide n’est pas une suite verte.')
  process.exit(1)
}

if (pending + todo > 0 || nonExecutes.length > 0) {
  console.error(`Tests sautés ou à faire détectés : pending=${pending}, todo=${todo}, détail=${nonExecutes.length}.`)
  for (const ligne of nonExecutes) console.error(`  - ${ligne}`)
  process.exit(1)
}

console.log(`Aucun test sauté : ${total} tests exécutés, pending=0, todo=0.`)
