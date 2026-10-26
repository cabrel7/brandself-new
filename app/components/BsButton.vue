<script setup lang="ts">
const props = defineProps<{
  variant?: 'principal' | 'contour' | 'lien'
  disabled?: boolean
}>()

const { variant = 'principal', disabled = false } = props

const classes = computed(() => {
  const base = 'bouton inline-flex items-center justify-center gap-2 min-h-3rem rounded-0-75rem border font-texte text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-55 disabled:cursor-not-allowed'
  const variants = {
    principal: 'bg-accent border-accent text-white',
    contour: 'bg-transparent border-bordure text-encre hover:bg-accent-doux',
    lien: 'bg-transparent border-transparent text-accent underline-offset-4 hover:underline',
  }
  return `${base} ${variants[variant]}`
})
</script>

<template>
  <button
    type="button"
    :class="classes"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.bouton {
  cursor: pointer;
}
</style>
