<script setup lang="ts">
import type { EtiquetteSupervision } from '~/utils/admin-supervision'

// Une ligne de santé : libellé, état (icône + texte, la couleur renforce seulement) et détail éventuel.
defineProps<{
  libelle: string
  etiquette: EtiquetteSupervision
  detail?: string
}>()
</script>

<template>
  <div class="flex min-h-(--cible-tactile) flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
    <div class="flex min-w-0 flex-col">
      <span class="font-medium text-encre">{{ libelle }}</span>
      <span v-if="detail" class="text-(length:--fs-14) text-texte-secondaire">{{ detail }}</span>
    </div>
    <UBadge
      :color="etiquette.couleur"
      :variant="etiquette.couleur === 'neutral' ? 'outline' : 'subtle'"
      :icon="etiquette.icone"
      size="lg"
      :class="etiquette.couleur === 'primary' ? 'text-accent-texte' : undefined"
    >
      {{ etiquette.libelle }}
    </UBadge>
  </div>
</template>
