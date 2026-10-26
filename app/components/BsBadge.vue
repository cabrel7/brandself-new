<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    size?: 'petit' | 'moyen'
    /** `vedette` ajoute une étoile ; le texte reste le seul porteur du sens. */
    variant?: 'defaut' | 'vedette'
  }>(),
  { label: undefined, size: 'moyen', variant: 'defaut' },
)
</script>

<template>
  <UBadge
    color="neutral"
    variant="outline"
    :size="size === 'petit' ? 'md' : 'lg'"
    :icon="variant === 'vedette' ? 'i-ph-star' : undefined"
  >
    <slot>{{ label }}</slot>
  </UBadge>
</template>
