<script setup lang="ts">
import type { AssistantDto } from '#shared/schemas/admin-a2'
import { ACTIONS_A2, libellePorteeAdmin } from '~/utils/admin-a2'
import { formaterDateHeureAdmin } from '~/utils/admin-paiements'

// Assistants connectés à un compte (consentements OAuth) : liste et retrait un par un. Jamais de jeton.
defineProps<{ assistants: AssistantDto[] }>()
const emit = defineEmits<{ retire: [] }>()

const definition = ACTIONS_A2.retirer_assistant
const cible = ref<AssistantDto | null>(null)
const dialogueOuvert = ref(false)

function ouvrir(assistant: AssistantDto): void {
  cible.value = assistant
  dialogueOuvert.value = true
}
</script>

<template>
  <p v-if="assistants.length === 0" class="m-0 text-base text-texte-secondaire">
    Aucun assistant n’est connecté à ce compte.
  </p>
  <ul v-else class="m-0 flex list-none flex-col divide-y divide-bordure p-0">
    <li v-for="assistant in assistants" :key="assistant.id" class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate font-semibold text-encre">{{ assistant.client }}</span>
        <span class="text-base text-texte-secondaire">
          {{ assistant.portees.length > 0 ? assistant.portees.map(libellePorteeAdmin).join(', ') : 'Aucune autorisation' }}
        </span>
        <span class="text-(length:--fs-14) text-texte-secondaire">
          {{ assistant.dernierUsage ? `Dernier usage le ${formaterDateHeureAdmin(assistant.dernierUsage)}` : 'Jamais utilisé' }}
        </span>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-ph-plugs"
        class="min-h-(--cible-tactile) shrink-0 justify-center"
        :aria-label="`Retirer l’assistant ${assistant.client}`"
        @click="ouvrir(assistant)"
      >
        Retirer
      </UButton>
    </li>
  </ul>

  <AdminReauthDialog
    v-if="cible"
    v-model:open="dialogueOuvert"
    :definition="definition"
    :cible-id="cible.id"
    @reussi="emit('retire')"
  />
</template>
