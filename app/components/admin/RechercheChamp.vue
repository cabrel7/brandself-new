<script setup lang="ts">
import { ADMIN_RECHERCHE_MAX, ADMIN_RECHERCHE_MIN } from '#shared/admin-a2'

// Champ de recherche d'une liste : libellé réel, aide quand la saisie est trop courte, bouton d'effacement.
defineProps<{
  label: string
  placeholder: string
  tropCourte: boolean
}>()
const saisie = defineModel<string>({ required: true })

const idAide = useId()
</script>

<template>
  <UFormField :label="label" :help="tropCourte ? `Saisissez au moins ${ADMIN_RECHERCHE_MIN} caractères.` : undefined" :ui="{ help: 'text-texte-secondaire' }">
    <UInput
      v-model="saisie"
      type="search"
      icon="i-ph-magnifying-glass"
      size="lg"
      class="w-full"
      autocomplete="off"
      :placeholder="placeholder"
      :maxlength="ADMIN_RECHERCHE_MAX"
      :aria-describedby="tropCourte ? idAide : undefined"
    >
      <template v-if="saisie.length > 0" #trailing>
        <UButton
          color="neutral"
          variant="link"
          size="md"
          icon="i-ph-x"
          aria-label="Effacer la recherche"
          class="min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center"
          @click="saisie = ''"
        />
      </template>
    </UInput>
  </UFormField>
</template>
