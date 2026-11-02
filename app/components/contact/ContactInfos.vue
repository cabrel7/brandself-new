<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'
import { lienWhatsapp } from '~/composables/usePublicService'

const props = defineProps<{ vitrine: VitrinePubliqueDTO }>()

const ACCROCHE_WHATSAPP = 'Bonjour, je vous contacte depuis votre vitrine Brandself.'

const liens = computed(() => ({
  email: props.vitrine.contact.email,
  telephone: props.vitrine.contact.telephone,
  whatsapp: lienWhatsapp(props.vitrine.contact.whatsapp, ACCROCHE_WHATSAPP),
  cabinet: `${props.vitrine.ville}, ${props.vitrine.paysLibelle}`,
}))

function lienTel(numero: string): string {
  return `tel:${numero.replace(/[\s().-]/g, '')}`
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ul class="m-0 list-none p-0">
      <li
        v-for="carte in [
          { icone: 'i-ph-envelope-simple', libelle: 'Email', valeur: liens.email, href: liens.email ? `mailto:${liens.email}` : null },
          { icone: 'i-ph-phone', libelle: 'Téléphone', valeur: liens.telephone, href: liens.telephone ? lienTel(liens.telephone) : null },
          { icone: 'i-ph-whatsapp-logo', libelle: 'WhatsApp', valeur: vitrine.contact.whatsapp, href: null },
          { icone: 'i-ph-map-pin', libelle: 'Cabinet', valeur: liens.cabinet, href: null },
        ].filter(carte => carte.valeur)"
        :key="carte.libelle"
        class="flex items-center gap-4 border-b border-bordure py-4 last:border-b-0"
      >
        <span class="flex size-12 shrink-0 items-center justify-center rounded-(--rayon-interne) bg-accent-doux text-accent-texte">
          <UIcon :name="carte.icone" class="size-5" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="m-0 text-(length:--fs-14) text-texte-secondaire">{{ carte.libelle }}</p>
          <a
            v-if="carte.href"
            :href="carte.href"
            class="break-all text-base font-bold text-encre no-underline underline-offset-4 hover:underline"
          >{{ carte.valeur }}</a>
          <p v-else class="m-0 break-all text-base font-bold text-encre">{{ carte.valeur }}</p>
        </div>
      </li>
    </ul>

    <UButton
      v-if="liens.whatsapp"
      :to="liens.whatsapp"
      target="_blank"
      rel="noopener"
      label="Écrire sur WhatsApp"
      icon="i-ph-whatsapp-logo"
      color="primary"
      variant="outline"
      size="lg"
      block
      class="min-h-(--cible-tactile)"
    />

    <div class="rounded-(--rayon-carte) bg-accent-doux p-6">
      <h2 class="m-0 text-(length:--fs-20) font-bold text-encre">Vous préférez réserver ?</h2>
      <p class="m-0 mt-2 text-base text-texte-secondaire">
        Choisissez directement un créneau dans l’agenda.
      </p>
      <NuxtLink
        :to="`/${vitrine.username}/agenda`"
        class="mt-3 inline-flex min-h-(--cible-tactile) items-center gap-1 font-semibold text-accent-texte hover:text-encre"
      >
        Voir l’agenda <span aria-hidden="false" class="font-normal">›</span>
      </NuxtLink>
    </div>
  </div>
</template>
