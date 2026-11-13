<script setup lang="ts">
import { MARQUE } from '#shared/brand'

type Variante = 'wordmark' | 'horizontal' | 'symbole' | 'empile'

const props = withDefaults(
  defineProps<{
    variante: Variante
    /** `terracotta` : fond sombre ou terracotta, on choisit la version blanche. */
    fond?: 'clair' | 'terracotta'
  }>(),
  { fond: 'clair' },
)

// Dimensions intrinsèques (viewBox des fichiers de public/brand/) : elles réservent
// l'espace avant le chargement (pas de décalage de mise en page).
const LOGOS: Record<Variante, { fichier: string, largeur: number, hauteur: number }> = {
  wordmark: { fichier: 'wordmark', largeur: 595, hauteur: 190 },
  horizontal: { fichier: 'logo', largeur: 800, hauteur: 290 },
  symbole: { fichier: 'symbole', largeur: 225, hauteur: 290 },
  empile: { fichier: 'logo-empile', largeur: 595, hauteur: 375 },
}

const logo = computed(() => LOGOS[props.variante])
const source = computed(() => {
  const suffixe = props.fond === 'terracotta' ? '-blanc' : ''
  // Le logo empilé n'existe qu'en une version : pas de variante blanche.
  const blanc = props.variante === 'empile' ? '' : suffixe
  return `/brand/${logo.value.fichier}${blanc}.svg`
})
</script>

<template>
  <!-- La taille vient de l'appelant (classe `h-*`) ; `w-auto` garde les proportions. -->
  <img
    :src="source"
    :alt="MARQUE.nom"
    :width="logo.largeur"
    :height="logo.hauteur"
    decoding="async"
    class="block w-auto max-w-full"
  >
</template>
