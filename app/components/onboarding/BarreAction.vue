<script setup lang="ts">
const props = defineProps<{
  label: string
  loading?: boolean
  /** Action pas encore possible : le bouton reste dans la tabulation (`aria-disabled`) et son aide est lue. */
  disabled?: boolean
  /** Texte qui explique pourquoi l'action n'est pas disponible (lu par les lecteurs d'écran). */
  aide?: string
}>()

const emit = defineEmits<{ continuer: [] }>()

const idAide = useId()

function surClic(): void {
  if (props.disabled) return
  emit('continuer')
}
</script>

<template>
  <div class="fixed inset-x-0 bottom-0 border-t border-bordure bg-fond">
    <div class="mx-auto flex w-full max-w-120 flex-col gap-3 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <slot name="message" />
      <p v-if="disabled && aide" :id="idAide" class="sr-only">{{ aide }}</p>
      <UButton
        block
        size="xl"
        class="h-(--hauteur-controle) justify-center font-semibold aria-disabled:hover:bg-primary aria-disabled:active:bg-primary"
        :label="label"
        :loading="loading"
        :aria-disabled="disabled ? 'true' : undefined"
        :aria-describedby="disabled && aide ? idAide : undefined"
        @click="surClic"
      />
    </div>
  </div>
</template>
