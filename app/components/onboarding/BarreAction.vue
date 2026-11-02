<script setup lang="ts">
defineProps<{
  label: string
  loading?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ continuer: [] }>()
</script>

<template>
  <div class="fixed inset-x-0 bottom-0 border-t border-bordure bg-fond">
    <div class="mx-auto flex w-full max-w-120 flex-col gap-3 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <slot name="message" />
      <UButton
        block
        size="xl"
        class="h-(--hauteur-controle) justify-center font-semibold"
        :label="label"
        :loading="loading"
        :disabled="disabled"
        @click="emit('continuer')"
      />
    </div>
  </div>
</template>
