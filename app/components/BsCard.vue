<script setup lang="ts">
defineProps<{
  variant?: 'default' | 'surligne'
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
</script>

<template>
  <div
    :class="['carte', { 'carte-surlignee': variant === 'surligne' }]"
  >
    <slot />
  </div>
</template>

<style scoped>
.carte {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
}
.carte-surlignee {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
}
</style>
