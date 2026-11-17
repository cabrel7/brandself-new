import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// `--accent-texte` est déclaré en valeur fixe par palette (et non par `color-mix`, que le moteur d'accessibilité de Lighthouse
// ne sait pas lire). Ce test garde la valeur fixe égale au mélange qu'elle remplace : 70 % accent, 30 % encre.

const CSS = readFileSync(path.resolve(__dirname, '../../app/assets/css/main.css'), 'utf8')
const PROPORTION_ACCENT = 0.7

function canaux(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
}

function melange(accent: string, encre: string): string {
  const [a, e] = [canaux(accent), canaux(encre)]
  const valeurs = a.map((v, i) => Math.round(PROPORTION_ACCENT * v + (1 - PROPORTION_ACCENT) * (e[i] as number)))
  return `#${valeurs.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** Corps de la règle dont le sélecteur est exactement `selecteur` (premier bloc rencontré). */
function bloc(selecteur: string): string {
  const debut = CSS.indexOf(`${selecteur} {`)
  expect(debut, `bloc ${selecteur}`).toBeGreaterThanOrEqual(0)
  return CSS.slice(debut, CSS.indexOf('}', debut))
}

function jeton(corps: string, nom: string): string {
  const m = new RegExp(`${nom}:\\s*(#[0-9A-Fa-f]{6});`).exec(corps)
  expect(m, `${nom} dans le bloc`).not.toBeNull()
  return (m as RegExpExecArray)[1] as string
}

const PALETTES: Array<{ nom: string, selecteur: string }> = [
  { nom: 'terracotta (défaut)', selecteur: ':root' },
  { nom: 'sauge', selecteur: '[data-palette="sauge"]' },
  { nom: 'indigo', selecteur: '[data-palette="indigo"]' },
  { nom: 'ocre', selecteur: '[data-palette="ocre"]' },
  { nom: 'bordeaux', selecteur: '[data-palette="bordeaux"]' },
]

describe('palettes : --accent-texte', () => {
  for (const { nom, selecteur } of PALETTES) {
    it(`should declare a fixed --accent-texte equal to 70 % accent and 30 % encre for ${nom}`, () => {
      const corps = bloc(selecteur)

      expect(jeton(corps, '--accent-texte').toUpperCase()).toBe(melange(jeton(corps, '--accent'), jeton(corps, '--encre')))
    })
  }

  it('should not compute --accent-texte with color-mix (resolved as color(srgb …), unreadable by the Lighthouse accessibility audit)', () => {
    expect(CSS).not.toMatch(/--accent-texte:\s*color-mix/)
  })
})
