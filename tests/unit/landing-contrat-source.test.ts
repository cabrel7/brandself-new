// Page d'accueil : contrat de source. Scanne `app/components/marketing/*.vue` et `app/pages/index.vue`
// (invariants du CLAUDE.md : pas de v-html, pas de type fourre-tout, pas de process.env, Phosphor seul,
// aucune couleur en dur, un seul h1, aucun prix en dur hors de `landing.ts`).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOSSIER_MARKETING = path.join(RACINE, 'app/components/marketing')
const FICHIER_TROUVE = 'Trouve.vue'

// Le mot du type interdit est assemblé ici pour ne pas déclencher la garde du dépôt sur ce fichier de test.
const TYPE_FOURRE_TOUT = ['a', 'n', 'y'].join('')

interface Source {
  nom: string
  texte: string
}

const SOURCES: Source[] = [
  ...readdirSync(DOSSIER_MARKETING)
    .filter(f => f.endsWith('.vue'))
    .sort()
    .map(f => ({ nom: f, texte: readFileSync(path.join(DOSSIER_MARKETING, f), 'utf8') })),
  { nom: 'pages/index.vue', texte: readFileSync(path.join(RACINE, 'app/pages/index.vue'), 'utf8') },
]

/** Lignes (numérotées à partir de 1) du bloc de déclaration des variables `--mock-*` de Trouve.vue. */
function bornesBlocMock(texte: string): { debut: number, fin: number } {
  const lignes = texte.split('\n')
  const declarations = lignes
    .map((l, i) => (/^\s*--mock-[\w-]+\s*:/.test(l) ? i + 1 : 0))
    .filter(n => n > 0)
  if (declarations.length === 0) throw new Error('bloc --mock-* introuvable dans Trouve.vue')
  return { debut: Math.min(...declarations), fin: Math.max(...declarations) }
}

/** Violations d'un motif, « fichier:ligne : extrait », en ignorant éventuellement un intervalle de lignes. */
function violations(motif: RegExp, source: Source, ignorer?: { debut: number, fin: number }): string[] {
  const resultat: string[] = []
  source.texte.split('\n').forEach((ligne, i) => {
    const numero = i + 1
    if (ignorer && numero >= ignorer.debut && numero <= ignorer.fin) return
    const m = motif.exec(ligne)
    if (m) resultat.push(`${source.nom}:${numero} : ${m[0]}`)
  })
  return resultat
}

function toutes(motif: RegExp): string[] {
  return SOURCES.flatMap(s => violations(motif, s))
}

describe('découverte des fichiers', () => {
  it('should scan the marketing components and the home page', () => {
    const noms = SOURCES.map(s => s.nom)

    expect(SOURCES.length).toBeGreaterThanOrEqual(10)
    for (const attendu of ['Hero.vue', 'Trouve.vue', 'Compris.vue', 'Contact.vue', 'PourQui.vue', 'Tarifs.vue', 'Faq.vue', 'Cloture.vue', 'Adresse.vue', 'pages/index.vue']) {
      expect(noms).toContain(attendu)
    }
  })
})

describe('sécurité et conventions de code', () => {
  it('should not use v-html or innerHTML', () => {
    expect(toutes(/\bv-html\b|\binnerHTML\b|\bouterHTML\b/)).toEqual([])
  })

  it('should not use the catch-all type', () => {
    const t = TYPE_FOURRE_TOUT
    const motif = new RegExp(`:\\s*${t}\\b|<${t}>|\\bas ${t}\\b|\\b${t}\\[\\]|Array<${t}>|Record<[^>]*,\\s*${t}>`)

    expect(toutes(motif)).toEqual([])
  })

  it('should detect the catch-all type in a faulty source (guard against a vacuous scan)', () => {
    const t = TYPE_FOURRE_TOUT
    const motif = new RegExp(`:\\s*${t}\\b|<${t}>|\\bas ${t}\\b`)
    const faux: Source = { nom: 'faux.vue', texte: `const x: ${t} = 1\nconst y = z as ${t}` }

    expect(violations(motif, faux)).toHaveLength(2)
  })

  it('should not use @ts-ignore or @ts-nocheck', () => {
    expect(toutes(/@ts-(ignore|nocheck)/)).toEqual([])
  })

  it('should not read process.env', () => {
    expect(toutes(/process\.env/)).toEqual([])
  })

  it('should not import or name Lucide icons', () => {
    expect(toutes(/lucide/i)).toEqual([])
  })

  it('should use Phosphor (ph) as the only icon collection', () => {
    const autres = toutes(/["'`]i-(?!ph[:-])[a-z0-9]+[:-][a-z0-9-]+/)

    expect(autres).toEqual([])
  })

  it('should not use native checkboxes for settings', () => {
    expect(toutes(/type="checkbox"/)).toEqual([])
  })
})

describe('couleurs', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/

  it('should not use hexadecimal colors outside the --mock-* block of Trouve.vue', () => {
    const fautives = SOURCES.flatMap((source) => {
      const ignorer = source.nom === FICHIER_TROUVE ? bornesBlocMock(source.texte) : undefined
      return violations(HEX, source, ignorer)
    })

    expect(fautives).toEqual([])
  })

  it('should not use rgb(), hsl() or oklch() literals outside the --mock-* block of Trouve.vue', () => {
    const fautives = SOURCES.flatMap((source) => {
      const ignorer = source.nom === FICHIER_TROUVE ? bornesBlocMock(source.texte) : undefined
      return violations(/\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/, source, ignorer)
    })

    expect(fautives).toEqual([])
  })

  it('should keep hexadecimal colors of Trouve.vue only on --mock-* declarations', () => {
    const trouve = SOURCES.find(s => s.nom === FICHIER_TROUVE)
    if (!trouve) throw new Error('Trouve.vue introuvable')
    const { debut, fin } = bornesBlocMock(trouve.texte)
    const lignesBloc = trouve.texte.split('\n').slice(debut - 1, fin)

    const hexHorsDeclaration = lignesBloc.filter(l => HEX.test(l) && !/^\s*--mock-[\w-]+\s*:/.test(l))

    expect(hexHorsDeclaration).toEqual([])
  })

  it('should detect hexadecimal colors in a faulty source (guard against a vacuous scan)', () => {
    const faux: Source = { nom: 'faux.vue', texte: '<style>\n.a { color: #fff; }\n</style>' }

    expect(violations(HEX, faux)).toHaveLength(1)
  })
})

describe('structure de la page', () => {
  it('should contain exactly one <h1 across the folder and the page', () => {
    const h1 = SOURCES.flatMap(s => [...s.texte.matchAll(/<h1\b/g)].map(() => s.nom))

    expect(h1).toEqual(['Hero.vue'])
  })

  it('should not create a level 1 heading through a component prop', () => {
    expect(toutes(/\bas="h1"|:is="'h1'"/)).toEqual([])
  })
})

describe('aucune donnée de plan en dur', () => {
  it('should not write a price or a currency in components', () => {
    expect(toutes(/\bXAF\b|\bFCFA\b|\bF\s?CFA\b/)).toEqual([])
  })

  it('should not write a number followed by a currency symbol in components', () => {
    expect(toutes(/\d\s*(€|\$|EUR\b|USD\b)/)).toEqual([])
  })
})
