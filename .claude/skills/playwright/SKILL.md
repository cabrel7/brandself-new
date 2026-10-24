---
managed-by: claude-system-v5
name: playwright
description: Utiliser pour écrire des tests end-to-end et de régression visuelle avec Playwright — page objects, sélecteurs sémantiques, toHaveScreenshot, gestion async. Playwright et Chromium sont déjà installés.
---

# Playwright — E2E & régression visuelle

## Sélecteurs (ordre de préférence)
1. `getByRole('button', { name: 'Enregistrer' })` — sémantique, accessible, stable
2. `getByLabel()`, `getByPlaceholder()`, `getByText()`
3. `getByTestId()` en dernier recours (data-testid explicite)
JAMAIS de sélecteurs CSS/XPath fragiles (`.btn-primary:nth-child(3)`).

## Page Object (1 par écran)
```ts
export class LoginPage {
  constructor(private page: Page) {}
  goto() { return this.page.goto('/login') }
  async login(email: string, pw: string) {
    await this.page.getByLabel('Email').fill(email)
    await this.page.getByLabel('Mot de passe').fill(pw)
    await this.page.getByRole('button', { name: 'Se connecter' }).click()
  }
}
```

## Attentes (jamais de sleep arbitraire)
```ts
await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
await expect(page).toHaveURL(/\/dashboard/)
// Auto-retry intégré : pas de waitForTimeout
```

## Régression visuelle
```ts
await expect(page).toHaveScreenshot('dashboard.png', { maxDiffPixelRatio: 0.01 })
// 1re exécution = baseline. Ensuite compare. Masque le dynamique :
await expect(page).toHaveScreenshot({ mask: [page.getByTestId('date-now')] })
```

## Parcours critiques à toujours couvrir
- Auth : login OK / mauvais mot de passe / session expirée
- Formulaire : soumission OK / validation en erreur / double-clic (idempotence)
- Paiement : succès / carte refusée / retour navigateur en cours de flow
- Permissions : accès refusé quand non autorisé

## Exécution
```bash
npx playwright test                      # tous
npx playwright test login.spec.ts        # ciblé
npx playwright test --update-snapshots   # régénère les baselines (après changement voulu)
npx playwright show-report               # rapport HTML
```
Utilise le Chromium préinstallé — ne lance PAS `playwright install`.

## Règles
- Un test = un parcours, indépendant (pas d'ordre implicite entre tests).
- `beforeEach` pour l'état de départ, nettoyage explicite après.
- Data-testid sur les éléments dynamiques à masquer en visual regression.
