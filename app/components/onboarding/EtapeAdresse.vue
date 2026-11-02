<script setup lang="ts">
import type { Palette } from '#shared/palettes'
import type { EtatUsername } from '~/composables/useUsernameDisponible'

defineProps<{
  etat: EtatUsername
  erreur?: string
  desactive: boolean
}>()

const emit = defineEmits<{ soumettre: [] }>()

const username = defineModel<string>('username', { required: true })
const palette = defineModel<Palette>('palette', { required: true })

const racine = useTemplateRef<HTMLFormElement>('racine')

function focusErreur(): void {
  racine.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

defineExpose({ focusErreur })
</script>

<template>
  <form ref="racine" class="flex flex-col gap-8" novalidate @submit.prevent="emit('soumettre')">
    <UFormField label="Votre adresse" name="username" :error="erreur">
      <UInput
        v-model="username"
        type="text"
        autocapitalize="none"
        autocomplete="off"
        spellcheck="false"
        :loading="etat === 'verification'"
        :disabled="desactive"
        class="w-full"
        :ui="{ base: 'ps-32!' }"
      >
        <template #leading>
          <span class="pointer-events-none text-texte-secondaire" aria-hidden="true">{{ HOTE_VITRINES }}/</span>
        </template>
      </UInput>
      <template #help>
        <span aria-live="polite">
          <span v-if="etat === 'libre'" class="flex items-center gap-2 font-semibold text-accent-texte">
            <UIcon name="i-ph-check" class="size-5" aria-hidden="true" />
            Cette adresse est disponible
          </span>
          <span v-else-if="etat === 'verification'" class="text-texte-secondaire">Vérification de l’adresse…</span>
        </span>
      </template>
    </UFormField>

    <section aria-labelledby="titre-couleurs" class="flex flex-col gap-3">
      <h2 id="titre-couleurs" class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold text-encre">
        Vos couleurs
      </h2>
      <PaletteChoice v-model="palette" labelledby="titre-couleurs" :disabled="desactive" />
    </section>
  </form>
</template>
