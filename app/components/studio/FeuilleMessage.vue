<script setup lang="ts">
import type { MessageStudioVue, VoisinsMessage } from '~/composables/useStudioMessages'

/** Feuille de lecture (< 1280 px) : UModal en bas sur mobile, centré dès `sm` (app.config). */
defineProps<{
  message: MessageStudioVue
  voisins: VoisinsMessage
  erreur: string | null
}>()

const emit = defineEmits<{ precedent: [], suivant: [], fermer: [], fermee: [] }>()

const ouverte = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="ouverte"
    :title="message.nom"
    :description="message.dateComplete"
    :close="false"
    @after:leave="emit('fermee')"
  >
    <template #body>
      <StudioMessageLecture
        :message="message"
        :voisins="voisins"
        :erreur="erreur"
        @precedent="emit('precedent')"
        @suivant="emit('suivant')"
      />
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        size="xl"
        block
        class="min-h-(--cible-tactile)"
        @click="emit('fermer')"
      >
        Fermer
      </UButton>
    </template>
  </UModal>
</template>
