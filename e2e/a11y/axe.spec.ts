// S12 : accessibilité (axe-core, WCAG 2 A/AA) sur le build de production. 0 violation critical/serious.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { attendreHydration } from '../helpers/hydratation'
import { USERNAME_DEMO } from '../helpers/seo'

const ETIQUETTES_WCAG = ['wcag2a', 'wcag2aa']
const IMPACTS_BLOQUANTS = ['critical', 'serious']

const PAGES = [
  { nom: 'page d’accueil', chemin: '/' },
  { nom: 'tarifs', chemin: '/tarifs' },
  { nom: 'connexion', chemin: '/connexion' },
  { nom: 'vitrine de démonstration', chemin: `/${USERNAME_DEMO}` },
] as const

for (const { nom, chemin } of PAGES) {
  test(`${nom} : aucune violation critical ou serious`, async ({ page }) => {
    await page.goto(chemin)
    await attendreHydration(page)

    const resultat = await new AxeBuilder({ page }).withTags(ETIQUETTES_WCAG).analyze()
    const bloquantes = resultat.violations.filter((violation) => IMPACTS_BLOQUANTS.includes(violation.impact ?? ''))

    expect(
      bloquantes.map((violation) => ({ regle: violation.id, impact: violation.impact, noeuds: violation.nodes.length })),
    ).toEqual([])
  })
}
