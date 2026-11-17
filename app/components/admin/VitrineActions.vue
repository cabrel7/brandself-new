<script setup lang="ts">
import type { VitrineFicheDto } from '#shared/schemas/admin-a2'
import { ACTIONS_A2 } from '~/utils/admin-a2'

// Dépublier ou republier une vitrine (blocage par l'administration). Le serveur reste la seule autorité.
const props = defineProps<{ vitrine: VitrineFicheDto }>()
const emit = defineEmits<{ fait: [] }>()

const dialogueOuvert = ref(false)

const definition = computed(() => (props.vitrine.bloquee ? ACTIONS_A2.republier : ACTIONS_A2.depublier))
// Une vitrine jamais publiée n'a rien à dépublier : le bouton est désactivé et dit pourquoi.
const desactive = computed(() => !props.vitrine.bloquee && !props.vitrine.publiee)
</script>

<template>
  <div class="flex flex-col items-start gap-2">
    <UButton
      :color="definition.destructive ? 'error' : 'primary'"
      :variant="definition.destructive ? 'outline' : 'solid'"
      size="lg"
      :icon="vitrine.bloquee ? 'i-ph-eye' : 'i-ph-eye-slash'"
      class="min-h-(--cible-tactile) justify-center"
      :disabled="desactive"
      @click="dialogueOuvert = true"
    >
      {{ definition.libelle }}
    </UButton>
    <p v-if="desactive" class="m-0 text-(length:--fs-14) text-texte-secondaire">
      Cette vitrine n’est pas encore publiée.
    </p>
  </div>

  <AdminReauthDialog
    v-model:open="dialogueOuvert"
    :definition="definition"
    :cible-id="vitrine.id"
    @reussi="emit('fait')"
  />
</template>
