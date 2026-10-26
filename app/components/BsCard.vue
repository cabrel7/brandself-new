<script setup lang="ts">
defineProps<{
  /** `doux` : fond d'accent doux (point focal d'un écran) ; `surligne` : légère élévation. */
  variant?: 'default' | 'doux' | 'surligne'
}>()
</script>

<template>
  <div
    class="flex flex-col gap-4 rounded-(--rayon) border border-bordure p-5"
    :class="{
      'bg-surface': variant !== 'doux',
      'bg-accent-doux': variant === 'doux',
      'shadow-[0_4px_12px_-2px_color-mix(in_srgb,var(--encre)_12%,transparent)]': variant === 'surligne',
    }"
  >
    <slot />
  </div>
</template>
