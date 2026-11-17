<script setup lang="ts">
import type { EtiquetteA2 } from '~/utils/admin-a2'

// Étiquettes d'un compte ou d'une vitrine : libellé et icône portent le sens, la couleur le renforce seulement.
defineProps<{ etiquettes: EtiquetteA2[] }>()
</script>

<template>
  <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
    <li v-for="etiquette in etiquettes" :key="etiquette.libelle">
      <UBadge
        :color="etiquette.couleur"
        :variant="etiquette.couleur === 'neutral' ? 'outline' : 'subtle'"
        :icon="etiquette.icone"
        size="lg"
        :class="etiquette.couleur === 'primary' ? 'text-accent-texte' : undefined"
      >
        {{ etiquette.libelle }}
      </UBadge>
    </li>
  </ul>
</template>
