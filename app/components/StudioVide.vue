<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description: string
  /** Action unique de l'état vide (facultative). */
  actionLabel?: string
  actionTo?: string
}>()
</script>

<template>
  <UEmpty
    :icon="icon"
    :title="title"
    :description="description"
    :as="{ title: 'h1' }"
    :actions="actionLabel && actionTo ? [{ label: actionLabel, to: actionTo, size: 'xl' }] : undefined"
  />
</template>
