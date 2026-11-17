<script setup lang="ts">
// Bouton « Ajouter » unique des en-têtes de liste du studio : icône, taille et cible tactile
// identiques partout. Les écouteurs (ex. @click) sont transmis au bouton.
defineProps<{
  label?: string
  /** Absent : le bouton ne navigue pas (limite du plan atteinte, géré par l'appelant via @click). */
  to?: string
}>()
</script>

<template>
  <UButton
    :label="label ?? 'Ajouter'"
    :to="to"
    icon="i-ph-plus"
    size="lg"
    class="min-h-(--cible-tactile) shrink-0 justify-center"
  />
</template>
