<script setup lang="ts">
import { formaterNombre } from '~/utils/admin-paiements'

// Liste de compteurs libellés (statuts, motifs, outils…), en lignes. Vide : une phrase, jamais une zone blanche.
withDefaults(
  defineProps<{
    titre: string
    elements: Array<{ id: string, libelle: string, nombre: number }>
    vide?: string
  }>(),
  { vide: 'Aucune donnée sur la période.' },
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <h3 class="m-0 text-base font-semibold text-texte-secondaire">
      {{ titre }}
    </h3>
    <p v-if="elements.length === 0" class="m-0 text-base text-texte-secondaire">
      {{ vide }}
    </p>
    <ul v-else class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
      <li v-for="element in elements" :key="element.id" class="flex min-h-(--cible-tactile) items-center justify-between gap-4 py-2">
        <span class="min-w-0 text-encre">{{ element.libelle }}</span>
        <span class="shrink-0 font-semibold text-encre">{{ formaterNombre(element.nombre) }}</span>
      </li>
    </ul>
  </div>
</template>
