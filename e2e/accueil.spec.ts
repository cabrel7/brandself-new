import { expect, test } from '@playwright/test'

test("la page d'accueil répond", async ({ page }) => {
  const reponse = await page.goto('/')
  expect(reponse?.status()).toBe(200)
})
