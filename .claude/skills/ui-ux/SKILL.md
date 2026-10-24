---
managed-by: claude-system-v5
name: ui-ux
description: Règles universelles de design UI/UX — hiérarchie, typographie, espacement, couleur, contraste WCAG, états obligatoires, micro-interactions, et anti-patterns IA génériques. Lire AVANT toute implémentation d'interface (React ou Vue).
---

# UI/UX — Règles universelles (agnostiques du framework)

> Ces règles valent pour React comme pour Vue. L'implémentation *technique* du design
> (transitions, suspense, focus trap) est dans les skills react-ts / vue3.

## 1. Les 10 principes
1. **Une intention par écran** — un seul point focal, une seule action primaire.
2. **Hiérarchie visuelle** — taille, poids, couleur et espace guident l'œil dans l'ordre de lecture.
3. **Loi de Hick** — moins de choix = décision plus rapide. Regroupe, masque le secondaire.
4. **Loi de Fitts** — cible fréquente = grande et proche. Cibles tactiles ≥ 44×44px.
5. **Proximité (Gestalt)** — ce qui est lié est proche ; l'espace sépare les groupes.
6. **Cohérence** — un même élément se comporte pareil partout (tokens, composants réutilisés).
7. **Feedback immédiat** — toute action a une réponse visible < 100ms (hover/press/loading).
8. **Prévention d'erreur** — désactive l'impossible, confirme le destructif, valide en direct.
9. **Reconnaissance > rappel** — labels clairs, pas d'icônes seules ambiguës.
10. **Accessibilité par défaut** — contraste, clavier, focus, aria dès la première version.

## 2. États OBLIGATOIRES par composant
| Type | États requis |
|------|--------------|
| Bouton | default · hover · focus-visible · active · disabled · loading |
| Champ | default · focus · filled · error (+message) · disabled |
| Donnée serveur | loading (skeleton court) · empty (message + action) · error (+retry) · success |
| Liste | vide · 1 élément · N éléments · pagination/scroll · erreur partielle |
| Modal | ouverture/fermeture animées · focus trap · fermeture Esc + clic overlay |

Une donnée serveur sans état `empty` et `error` distincts = incomplet.

## 3. Typographie
- Échelle limitée : 12 / 14 / 16 / 20 / 24 / 32 / 48 (pas 11 tailles arbitraires).
- Corps de texte 16px, hauteur de ligne 1.5, largeur de ligne 45–75 caractères.
- 2 familles max (display + body). Poids : 400 / 500 / 700, pas 6 poids.
- Jamais de texte gris clair sur blanc pour du contenu important (contraste).

## 4. Espacement — échelle 8px
Utilise 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. Jamais de valeurs au pixel près sorties de nulle part.
L'espace *entre* les groupes > l'espace *dans* un groupe (proximité).

## 5. Couleur & contraste (WCAG 2.1 AA)
- Texte normal ≥ 4.5:1 · texte large (≥24px ou 19px bold) ≥ 3:1 · éléments UI/icônes ≥ 3:1.
- Ne JAMAIS coder de couleur des tokens : `var(--brand-primary)`, pas `#1A56DB` en dur.
- La couleur ne porte jamais seule l'information (ajoute icône/texte pour daltoniens).
- Palette : 1 primaire, 1 accent, neutres (gris), sémantiques (success/warning/danger).

## 6. Micro-interactions & motion
- Durées : 150–250ms (UI), 300ms max. Easing : ease-out (entrée), ease-in (sortie).
- Anime transform/opacity (GPU), pas width/height/top/left.
- Respecte `prefers-reduced-motion` : coupe/réduit les animations.
- Pas d'animation sur l'action primaire (elle doit paraître instantanée).

## 7. Anti-patterns IA génériques (à BANNIR — c'est ce qui fait "interface d'IA")
- **Tout en cards** : des cards partout, même pour une simple liste → utilise des lignes.
- **Boutons fantômes partout** : hiérarchie plate, on ne sait pas quelle est l'action primaire.
- **Gradients violet/rose décoratifs** et glassmorphism gratuit.
- **Skeletons abusifs** : skeleton pour un chargement de 50ms → flash désagréable.
- **Modals pour tout** : une modal pour une action qui tient inline.
- **Emojis en guise d'icônes** dans une UI pro.
- **Densité nulle** : padding géant, 3 éléments par écran, scroll infini pour rien.
- **Tout centré** : le centrage systématique tue la hiérarchie et la scannabilité.
- **Placeholder = label** : le placeholder disparaît à la saisie → toujours un vrai label.
- **Toasts pour les erreurs bloquantes** : une erreur de formulaire va SOUS le champ.

## 8. Références de qualité
Vise le niveau **Stripe / Linear / Vercel** : sobre, dense mais aéré, typographie soignée,
neutres froids, un seul accent, états impeccables. Pas Dribbble-fantaisie.

## 9. Checklist avant de livrer un écran
- [ ] Un point focal, une action primaire évidente
- [ ] Tous les états (loading/empty/error/success) présents
- [ ] Contraste AA vérifié · focus visible · navigable au clavier
- [ ] Cibles ≥ 44px · labels réels · aria si custom
- [ ] Tokens partout, zéro couleur/espacement en dur
- [ ] Aucun anti-pattern de la section 7
- [ ] `prefers-reduced-motion` respecté
