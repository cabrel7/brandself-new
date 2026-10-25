<script setup lang="ts">
const props = defineProps<{
  valeur: string
}>()

const { valeur } = props

const classes = computed(() => {
  const base = 'badge badge-petit'
  const variants = {
    rdv: 'bg-accent border-accent text-white',
    accompagnement: 'bg-transparent border-bordure text-encre',
    atelier: 'bg-transparent border-bordure text-encre',
    devis: 'bg-transparent border-bordure text-encre',
  }
  return `${base} ${variants[valeur as keyof typeof variants] || variants.rdv}`
})
</script>

<template>
  <span :class="classes">{{ valeur }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0 0.5rem;
  height: 1.75rem;
  border-radius: 1rem;
  border: 1px solid var(--bordure);
  background-color: var(--accent-doux);
  color: var(--encre);
  font-size: 0.75rem;
  font-weight: 600;
}
</style>
