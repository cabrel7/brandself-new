<script setup lang="ts">
defineProps<{
  label?: string
  disabled?: boolean
  modelValue?: string | number
}>()
</script>

<template>
  <div class="champ">
    <label v-if="label" class="label">{{ label }}</label>
    <slot />
    <p v-if="$props.error" class="erreur" role="alert">{{ $props.error }}</p>
  </div>
</template>

<style scoped>
.label {
  font-size: 0.85rem;
  color: var(--texte-secondaire);
}
.erreur {
  color: var(--erreur);
  font-size: 0.9rem;
}
</style>
