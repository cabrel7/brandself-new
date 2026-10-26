<script setup lang="ts">
import type { ServicePublicDetailDTO } from '#shared/dto'
import type { ServiceLien } from '~/composables/usePublicService'

defineProps<{
  service: ServicePublicDetailDTO
  action: ServiceLien
  lieu: string
  whatsapp: string | null
}>()
</script>

<template>
  <aside aria-label="Tarif et réservation" class="flex flex-col gap-5 rounded-3xl border border-bordure bg-surface p-6 lg:sticky lg:top-6">
    <div class="flex flex-col gap-2">
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent uppercase">
        {{ service.type === 'accompagnement' && service.tarif === 'payant' ? 'Forfait' : 'Tarif' }}
      </p>
      <p class="font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold">{{ prixSeul(service) }}</p>
      <p v-if="resumeDuree(service, 'long')" class="text-texte-secondaire">{{ resumeDuree(service, 'long') }}</p>
    </div>

    <ul class="flex flex-col gap-3 border-y border-bordure py-4">
      <li v-if="phraseReglement(service)" class="flex items-center gap-3">
        <UIcon name="i-ph-wallet" class="size-5 shrink-0 text-accent" aria-hidden="true" />
        {{ phraseReglement(service) }}
      </li>
      <li class="flex items-center gap-3">
        <UIcon name="i-ph-map-pin" class="size-5 shrink-0 text-accent" aria-hidden="true" />
        {{ lieu }}
      </li>
    </ul>
    <p v-if="service.tarif === 'payant' && service.paiementInstructions" class="text-(length:--fs-14) whitespace-pre-line text-texte-secondaire">
      {{ service.paiementInstructions }}
    </p>

    <div class="flex flex-col gap-3">
      <UButton :to="action.to" :target="action.externe ? '_blank' : undefined" :rel="action.externe ? 'noopener' : undefined" block>
        {{ action.libelle }}
      </UButton>
      <UButton
        v-if="whatsapp && service.reservable"
        :to="whatsapp"
        target="_blank"
        rel="noopener"
        variant="outline"
        block
        icon="i-ph-whatsapp-logo"
      >
        Poser une question sur WhatsApp
      </UButton>
    </div>
    <p v-if="service.type === 'accompagnement' && service.reservable" class="text-(length:--fs-14) text-texte-secondaire">
      Les séances suivantes sont planifiées ensemble après la première.
    </p>
  </aside>
</template>
