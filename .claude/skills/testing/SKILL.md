---
managed-by: claude-system-v5
name: testing
description: Utiliser pour générer des tests — Vitest + Testing Library (front), Pest/PHPUnit (Laravel), et Playwright pour l'E2E et la régression visuelle.
---

# Testing

## Vitest + Testing Library (structure AAA)
```ts
describe('UserCard', () => {
  it('should display name when loaded', () => {
    mockUseUser.mockReturnValue({ data: { id:'1', name:'Alice' }, isLoading:false })  // Arrange
    render(<UserCard userId="1" />)                                                    // Act
    expect(screen.getByText('Alice')).toBeInTheDocument()                              // Assert
  })
})
```
- `userEvent` v14 (await) · `getByRole` > `getByText` > `getByTestId`
- `waitFor` pour l'async · MSW/`vi.mock` pour l'API · comportement observable
- Toujours : rendu loading / data / error / empty

## Pest/PHPUnit (Laravel)
```php
it('met à jour un post autorisé', function () {
  $u=User::factory()->create(); $p=Post::factory()->for($u)->create();
  $this->actingAs($u,'api')->putJson("/api/posts/{$p->id}",['title'=>'Maj'])
       ->assertOk()->assertJsonPath('title','Maj');
});
```
Couvrir 200/201/401/403/404/422 · RefreshDatabase · factories · assertDatabaseHas.

## E2E — Playwright (voir skill playwright pour le détail)
- Sélecteurs sémantiques (`getByRole`), Page Objects stables, `toHaveScreenshot()` pour la régression.
- Parcours critiques : auth (OK/échec/expiré), formulaire (OK/erreur/double-submit),
  paiement (succès/refus/retour), permissions.
- LANCE `npx playwright test` et colle la sortie brute (Chromium préinstallé — pas de `playwright install`).

## Cas souvent oubliés (à couvrir)
Concurrence (2 requêtes simultanées), données corrompues/partielles, permissions croisées
(user A accède aux données de B → 403), limites de quota, réseau lent/coupé.

## PREUVE
Tout test livré s'accompagne de la SORTIE BRUTE d'exécution. Un run "vert" non montré n'existe pas.

## Couverture cible
Services 90% · endpoints 80% · helpers 95% · composants 70% (happy + error obligatoires).
