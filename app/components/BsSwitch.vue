<script setup lang="ts">
// Surcouche de USwitch : conserve l'API `v-model` + `label` des écrans existants.
defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <USwitch
    :model-value="modelValue"
    :label="label"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event === true)"
  />
</template>
