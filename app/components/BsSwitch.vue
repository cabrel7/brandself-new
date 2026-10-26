<script setup lang="ts">
interface Props {
  modelValue: boolean
  label?: string
  disabled?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
</script>

<template>
  <button
    type="button"
    :class="
      'switch relative inline-flex w-10 h-6 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer ' +
      (props.modelValue ? 'bg-accent border-accent' : 'bg-surface border-bordure')"
    :aria-pressed="props.modelValue"
    :disabled="props.disabled"
    @click="emit('update:modelValue', !props.modelValue)"
  >
    <span
      class="switch-thumb block w-5 h-5 rounded-full bg-white transition-transform"
      :class="props.modelValue ? 'translate-x-4' : 'translate-x-0.5'"
    />
  </button>
  <label v-if="props.label" class="switch-label ml-2">{{ props.label }}</label>
</template>

<style scoped>
.switch-label {
  font-size: 0.95rem;
  color: var(--encre);
}
.switch-thumb {
  transform: translatex(0);
}
</style>
