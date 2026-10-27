import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const DELAI_HYDRATATION_MS = 90_000

/**
 * Attend que Vue ait repris la main. Sans cette attente, un clic précoce déclenche la soumission
 * native du formulaire (même garde que e2e/connexion.spec.ts).
 */
export async function attendreHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const racine = document.getElementById('__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null
      return Boolean(racine?.__vue_app__)
    },
    undefined,
    { timeout: DELAI_HYDRATATION_MS },
  )
}

const FENETRE_LIMITEUR_MS = 90_000
const INTERVALLE_REESSAI_MS = 5_000

/**
 * Ouvre une page du studio (ssr:false) et attend son hydratation. Le limiteur de Better Auth (100 req/min/IP,
 * en mémoire, 429 sur get-session) peut être saturé par les specs précédentes ; l'application affiche alors
 * « Un incident est survenu » au lieu de la page. On recharge jusqu'à ce que la fenêtre se vide.
 */
export async function ouvrirStudio(page: Page, chemin: string): Promise<void> {
  await expect(async () => {
    await page.goto(chemin)
    await attendreHydration(page)
    await expect(page.getByRole('heading', { name: 'Un incident est survenu.' })).toHaveCount(0, { timeout: 3_000 })
  }).toPass({ timeout: FENETRE_LIMITEUR_MS, intervals: [INTERVALLE_REESSAI_MS] })
}
