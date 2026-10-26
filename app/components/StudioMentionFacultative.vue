<script setup lang="ts">
/** Mention des champs non obligatoires, à placer à la suite du libellé (slot `label` d'un UFormField). */
defineProps<{
  /** Libellé féminin (« Photo ») : « facultative ». */
  feminin?: boolean
}>()
</script>

<template>
  <span class="font-normal text-texte-secondaire">· {{ feminin ? 'facultative' : 'facultatif' }}</span>
</template>
