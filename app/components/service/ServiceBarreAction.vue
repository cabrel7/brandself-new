<script setup lang="ts">
import type { ServicePublicDetailDTO } from '#shared/dto'
import type { ServiceLien } from '~/composables/usePublicService'
import { libellePrix } from '#shared/services'

defineProps<{ service: ServicePublicDetailDTO, action: ServiceLien }>()
</script>

<template>
  <div
    role="region"
    aria-label="Réservation"
    class="fixed inset-x-0 bottom-0 z-10 border-t border-bordure bg-fond px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
  >
    <div class="mx-auto flex max-w-2xl items-center justify-between gap-4">
      <p class="flex min-w-0 flex-col">
        <span v-if="resumeDuree(service, 'court')" class="text-(length:--fs-14) text-texte-secondaire">{{ resumeDuree(service, 'court') }}</span>
        <span class="truncate font-semibold">{{ libellePrix(service) }}</span>
      </p>
      <UButton :to="action.to" :target="action.externe ? '_blank' : undefined" :rel="action.externe ? 'noopener' : undefined" class="shrink-0">
        {{ action.libelle }}
      </UButton>
    </div>
  </div>
</template>
