<script setup lang="ts">
defineProps<{
  to: string
  label: string
}>()
</script>

<template>
  <NuxtLink
    :to="to"
    class="-ml-2 inline-flex min-h-(--cible-tactile) items-center gap-2 rounded-(--rayon-interne) px-2 text-base text-texte-secondaire no-underline transition-colors hover:text-encre"
  >
    <UIcon name="i-ph-arrow-left" class="size-5" aria-hidden="true" />
    {{ label }}
  </NuxtLink>
</template>
