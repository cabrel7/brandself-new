import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { Pool } from 'pg'

function lireEnv(nom: string): string {
  const contenu = readFileSync('.env', 'utf-8')
  const ligne = contenu.split('\n').find((l) => l.startsWith(`${nom}=`))
  if (!ligne) {
    throw new Error(`Variable ${nom} absente de .env`)
  }
  return ligne.slice(nom.length + 1).trim()
}

const pool = new Pool({ connectionString: lireEnv('DATABASE_URL') })

// Better Auth stocke l'identifiant préfixé pour l'email (`sign-in-otp-<email>`,
// voir email-otp/utils.mjs) et brut pour le téléphone ; la valeur est
// `<code>:<essais>`.
async function lireDernierCode(
  identifiant: string,
  canal: 'email' | 'telephone' = 'email',
): Promise<string> {
  const cle = canal === 'email' ? `sign-in-otp-${identifiant}` : identifiant
  const resultat = await pool.query(
    'SELECT value FROM verifications WHERE identifier = $1 ORDER BY created_at DESC LIMIT 1',
    [cle],
  )
  const valeur = resultat.rows[0]?.value
  const code = typeof valeur === 'string' ? valeur.split(':')[0] : undefined
  if (!code || code.length !== 6) {
    throw new Error(`Code OTP introuvable en base pour ${identifiant}`)
  }
  return code
}

// L'hydratation est lente sur cette machine (compilation à la demande) :
// sans cette attente, le clic déclenche la soumission native du formulaire.
async function attendreHydration(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const racine = document.getElementById('__nuxt') as
        | (HTMLElement & { __vue_app__?: unknown })
        | null
      return Boolean(racine?.__vue_app__)
    },
    undefined,
    { timeout: 90_000 },
  )
}

async function seConnecterParEmail(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/connexion')
  await attendreHydration(page)
  await page.getByLabel('Adresse email').fill(email)
  await page.getByRole('button', { name: 'Recevoir mon code' }).click()
  await expect(page).toHaveURL(/\/connexion\/code/)
  const code = await lireDernierCode(email)
  const cases = page.locator('.cases input')
  for (let i = 0; i < 6; i += 1) {
    await cases.nth(i).fill(code[i])
  }
  await page.getByRole('button', { name: 'Me connecter' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
}

test('parcours complet : email → code → onboarding', async ({ page }) => {
  const email = `e2e-${Date.now()}@exemple.com`
  await seConnecterParEmail(page, email)
  await expect(page.getByRole('heading', { name: 'Bienvenue.' })).toBeVisible()
})

test('parcours complet : téléphone → code → onboarding', async ({ page }) => {
  const telephone = `+2376${Date.now().toString().slice(-8)}`
  await page.goto('/connexion')
  await attendreHydration(page)
  await page.getByRole('tab', { name: 'Téléphone' }).click()
  await page.getByLabel('Numéro de téléphone').fill(telephone.slice(4))
  await page.getByRole('button', { name: 'Recevoir mon code' }).click()
  await expect(page).toHaveURL(/\/connexion\/code/)
  const code = await lireDernierCode(telephone, 'telephone')
  const cases = page.locator('.cases input')
  for (let i = 0; i < 6; i += 1) {
    await cases.nth(i).fill(code[i])
  }
  await page.getByRole('button', { name: 'Me connecter' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  await expect(page.getByRole('heading', { name: 'Bienvenue.' })).toBeVisible()
})

test('mauvais code : message avec essais restants', async ({ page }) => {
  const email = `e2e-echec-${Date.now()}@exemple.com`
  await page.goto('/connexion')
  await attendreHydration(page)
  await page.getByLabel('Adresse email').fill(email)
  await page.getByRole('button', { name: 'Recevoir mon code' }).click()
  await expect(page).toHaveURL(/\/connexion\/code/)
  const cases = page.locator('.cases input')
  for (let i = 0; i < 6; i += 1) {
    await cases.nth(i).fill('0')
  }
  await page.getByRole('button', { name: 'Me connecter' }).click()
  await expect(page.getByRole('alert')).toContainText('Il vous reste 2 essais')
})

test("non-divulgation de l'existence d'un compte", async ({ request }) => {
  const horodatage = Date.now()
  const emailExistant = `e2e-divulg-${horodatage}@exemple.com`
  const emailInexistant = `e2e-inexistant-${horodatage}@exemple.com`

  // Compte créé directement en base : un envoi préalable déclencherait le garde
  // de renvoi (1 envoi / 60 s / identifiant) et fausserait la comparaison.
  await pool.query(
    'INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)',
    [`e2e-divulg-${horodatage}`, 'Compte E2E', emailExistant],
  )

  const pourExistant = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email: emailExistant, type: 'sign-in' },
  })
  const pourInexistant = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email: emailInexistant, type: 'sign-in' },
  })

  expect(pourExistant.ok()).toBe(true)
  expect(pourInexistant.ok()).toBe(true)
  expect(pourExistant.status()).toBe(pourInexistant.status())

  const reponseExistant = await pourExistant.text()
  const reponseInexistant = await pourInexistant.text()
  expect(reponseExistant).toBe(reponseInexistant)
  expect(reponseExistant).toContain('"success":true')

  // Les deux envois stockent réellement un code en base.
  expect(await lireDernierCode(emailExistant)).toHaveLength(6)
  expect(await lireDernierCode(emailInexistant)).toHaveLength(6)
})

test('/studio exige une session', async ({ page }) => {
  await page.goto('/studio')
  await expect(page).toHaveURL(/\/connexion/)
})

test('déconnexion puis /studio redirige vers /connexion', async ({ page }) => {
  const email = `e2e-deconnexion-${Date.now()}@exemple.com`
  await seConnecterParEmail(page, email)
  await page.goto('/studio')
  await attendreHydration(page)
  await page.getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page).toHaveURL(/\/connexion/)
  await page.goto('/studio')
  await expect(page).toHaveURL(/\/connexion/)
})

test('@username et [username] coexistent', async ({ page }) => {
  await page.goto('/@dr-cabrel')
  await expect(page.getByRole('heading', { name: 'Page de liens' })).toBeVisible()
  await page.goto('/dr-cabrel')
  await expect(page.getByRole('heading', { name: 'Vitrine' })).toBeVisible()
})

test.afterAll(async () => {
  await pool.end()
})
