import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PALETTES } from '../../shared/palettes'
import type { Palette } from '../../shared/palettes'
import { ACCENTS, contraste } from './emails-support'

// ÉTAPE 1 (RED) — EM-CA16 (contrastes WCAG) et EM-CA17 (jetons = main.css, aucun hex ailleurs).
// CONTRAT SUPPOSÉ : `gabarit/jetons.ts` exporte `JETONS_PALETTES: Record<Palette, Record<CleJeton, string>>` avec les
// clés fond, surface, encre, texteSecondaire, accent, accentDoux, bordure, erreur, champ, surAccent (valeurs `#RRGGBB`).

const RACINE = path.resolve(__dirname, '../..')
const CLES = ['fond', 'surface', 'encre', 'texteSecondaire', 'accent', 'accentDoux', 'bordure', 'erreur', 'champ', 'surAccent'] as const
type Cle = (typeof CLES)[number]
const VARIABLES_CSS: Readonly<Record<Cle, string>> = {
  fond: 'fond',
  surface: 'surface',
  encre: 'encre',
  texteSecondaire: 'texte-secondaire',
  accent: 'accent',
  accentDoux: 'accent-doux',
  bordure: 'bordure',
  erreur: 'erreur',
  champ: 'champ',
  surAccent: 'sur-accent',
}
const SEUIL_WCAG_TEXTE = 4.5
const PAIRES: ReadonlyArray<readonly [Cle, Cle]> = [
  ['surAccent', 'accent'],
  ['encre', 'champ'],
  ['texteSecondaire', 'champ'],
  ['texteSecondaire', 'surface'],
  ['accent', 'champ'],
  ['encre', 'surface'],
]

const jetons = () => import('../../server/services/emails/gabarit/jetons')

function variablesDuBloc(css: string, selecteur: RegExp): Record<string, string> {
  const bloc = selecteur.exec(css)?.[1] ?? ''
  return Object.fromEntries([...bloc.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1] as string, (m[2] as string).toUpperCase()]))
}

/** Valeurs de la palette dans main.css : `:root` (Terracotta) puis la surcharge `[data-palette="x"]`. */
function paletteCss(palette: Palette): Record<Cle, string> {
  const css = readFileSync(path.join(RACINE, 'app/assets/css/main.css'), 'utf8')
  const racine = variablesDuBloc(css, /:root\s*\{([^}]*)\}/)
  const surcharge = palette === 'terracotta' ? {} : variablesDuBloc(css, new RegExp(`\\[data-palette="${palette}"\\]\\s*\\{([^}]*)\\}`))
  const fusion = { ...racine, ...surcharge }
  return Object.fromEntries(CLES.map((cle) => [cle, fusion[VARIABLES_CSS[cle]] ?? ''])) as Record<Cle, string>
}

describe('EM-CA17 jetons de couleur = main.css', () => {
  it('should expose exactly the five palettes with every token as #RRGGBB', async () => {
    const { JETONS_PALETTES } = await jetons()

    expect(Object.keys(JETONS_PALETTES).sort()).toEqual([...PALETTES].sort())
    for (const palette of PALETTES) {
      expect(Object.keys(JETONS_PALETTES[palette]).sort(), palette).toEqual([...CLES].sort())
      for (const cle of CLES) expect(JETONS_PALETTES[palette][cle], `${palette}.${cle}`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it.each(PALETTES)('should equal the CSS variables of %s in app/assets/css/main.css', async (palette) => {
    const { JETONS_PALETTES } = await jetons()
    const attendu = paletteCss(palette)

    for (const cle of CLES) {
      expect(attendu[cle], `main.css ${palette}.${cle} introuvable`).not.toBe('')
      expect(JETONS_PALETTES[palette][cle].toUpperCase(), `${palette}.${cle}`).toBe(attendu[cle])
    }
  })

  it('should keep the darkened Ocre accent #946409 (the document value #9A6A0F fails WCAG on the background)', async () => {
    const { JETONS_PALETTES } = await jetons()

    expect(JETONS_PALETTES.ocre.accent.toUpperCase()).toBe('#946409')
  })

  it('should match the accents the HTML tests expect for the five palettes', async () => {
    const { JETONS_PALETTES } = await jetons()

    for (const palette of PALETTES) expect(JETONS_PALETTES[palette].accent.toUpperCase(), palette).toBe(ACCENTS[palette])
  })

  it('should contain no hexadecimal color in server/services/emails outside gabarit/jetons.ts', () => {
    const dossier = path.join(RACINE, 'server/services/emails')
    const fichiers = readdirSync(dossier, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && f.replaceAll('\\', '/') !== 'gabarit/jetons.ts')

    expect(fichiers.length).toBeGreaterThan(0)
    for (const fichier of fichiers) {
      const source = readFileSync(path.join(dossier, fichier), 'utf8')
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/(^|\s)\/\/.*$/gm, '$1')
      expect(source.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) ?? [], fichier).toEqual([])
    }
  })
})

describe('EM-CA16 contrastes WCAG des jetons', () => {
  it.each(PALETTES)('should reach 4.5:1 on every text pair of the %s palette', async (palette) => {
    const { JETONS_PALETTES } = await jetons()
    const p = JETONS_PALETTES[palette]

    for (const [premier, second] of PAIRES) {
      expect(contraste(p[premier], p[second]), `${palette} ${premier}/${second}`).toBeGreaterThanOrEqual(SEUIL_WCAG_TEXTE)
    }
  })

  it('should compute the contrast of black on white as 21 and of identical colors as 1 (helper sanity)', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contraste('#B4532F', '#B4532F')).toBeCloseTo(1, 5)
  })
})
