<script setup lang="ts">
defineProps<{
  label?: string
  size?: 'petit' | 'moyen'
}>()
</script>

<template>
  <span
    :class="['badge', { 'badge-petit': size === 'petit' }]"
  >
    {{ label }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0 0.75rem;
  height: 2rem;
  border-radius: 1rem;
  border: 1px solid var(--bordure);
  background-color: var(--accent-doux);
  color: var(--encre);
  font-size: 0.85rem;
  font-weight: 600;
}
.badge-petit {
  padding: 0 0.5rem;
  height: 1.75rem;
  font-size: 0.75rem;
}
</style>
