<script setup lang="ts">
defineProps<{ username: string }>()
</script>

<template>
  <div class="mt-6 flex flex-col items-start gap-3" role="status">
    <p class="m-0 flex items-start gap-3 text-texte-secondaire">
      <UIcon name="i-ph-calendar-x" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <span>{{ MESSAGE_RESERVATIONS_INDISPONIBLES }}</span>
    </p>
    <UButton :to="`/${username}/contact`" label="Contacter directement" variant="outline" class="min-h-(--cible-tactile)" />
  </div>
</template>
