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

const cartes = computed(() => [
  { icone: 'i-ph-envelope-simple', libelle: 'Email', valeur: liens.value.email, href: liens.value.email ? `mailto:${liens.value.email}` : null },
  { icone: 'i-ph-phone', libelle: 'Téléphone', valeur: liens.value.telephone, href: liens.value.telephone ? lienTel(liens.value.telephone) : null },
  { icone: 'i-ph-whatsapp-logo', libelle: 'WhatsApp', valeur: props.vitrine.contact.whatsapp, href: null },
  { icone: 'i-ph-map-pin', libelle: 'Cabinet', valeur: liens.value.cabinet, href: null },
].filter(carte => carte.valeur))
</script>

<template>
  <div class="flex flex-col gap-6">
    <ul class="m-0 list-none p-0">
      <li
        v-for="carte in cartes"
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
            class="break-all text-base font-bold text-encre underline underline-offset-4 hover:text-accent-texte"
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
        Voir l’agenda <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
      </NuxtLink>
    </div>
  </div>
</template>
