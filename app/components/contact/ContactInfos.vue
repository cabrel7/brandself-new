<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'
import { MARQUE } from '#shared/brand'
import { lienWhatsapp } from '~/composables/usePublicService'

const props = defineProps<{ vitrine: VitrinePubliqueDTO }>()

const ACCROCHE_WHATSAPP = `Bonjour, je vous contacte depuis votre vitrine ${MARQUE.nom}.`

interface LigneContact {
  icone: string
  libelle: string
  valeur: string | null
  href: string | null
  externe: boolean
}

function lienTel(numero: string): string {
  return `tel:${numero.replace(/[\s().-]/g, '')}`
}

const lignes = computed<LigneContact[]>(() => {
  const { email, telephone, whatsapp } = props.vitrine.contact
  const toutes: LigneContact[] = [
    { icone: 'i-ph-envelope-simple', libelle: 'E-mail', valeur: email, href: email ? `mailto:${email}` : null, externe: false },
    { icone: 'i-ph-phone', libelle: 'Téléphone', valeur: telephone, href: telephone ? lienTel(telephone) : null, externe: false },
    { icone: 'i-ph-whatsapp-logo', libelle: 'WhatsApp', valeur: whatsapp, href: lienWhatsapp(whatsapp, ACCROCHE_WHATSAPP), externe: true },
    { icone: 'i-ph-map-pin', libelle: 'Cabinet', valeur: `${props.vitrine.ville}, ${props.vitrine.paysLibelle}`, href: null, externe: false },
  ]
  return toutes.filter(ligne => ligne.valeur)
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="rounded-(--rayon-carte) bg-accent-doux p-6">
      <h2 class="m-0 text-(length:--fs-20) font-bold text-encre">Vous préférez réserver ?</h2>
      <p class="m-0 mt-2 text-base text-texte-secondaire">
        Choisissez directement un créneau dans l’agenda.
      </p>
      <UButton
        :to="`/${vitrine.username}/agenda`"
        label="Voir l’agenda"
        trailing-icon="i-ph-caret-right"
        color="primary"
        size="lg"
        class="mt-4 min-h-(--cible-tactile)"
      />
    </div>

    <ul class="m-0 list-none p-0">
      <li
        v-for="ligne in lignes"
        :key="ligne.libelle"
        class="border-b border-bordure last:border-b-0"
      >
        <component
          :is="ligne.href ? 'a' : 'div'"
          :href="ligne.href ?? undefined"
          :target="ligne.href && ligne.externe ? '_blank' : undefined"
          :rel="ligne.href && ligne.externe ? 'noopener nofollow' : undefined"
          class="flex min-h-(--cible-tactile) items-center gap-4 py-4"
          :class="ligne.href && 'group rounded-(--rayon-interne) hover:text-accent-texte focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-texte'"
        >
          <span class="flex size-12 shrink-0 items-center justify-center rounded-(--rayon-interne) bg-accent-doux text-accent-texte">
            <UIcon :name="ligne.icone" class="size-5" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-(length:--fs-14) text-texte-secondaire">{{ ligne.libelle }}</span>
            <span class="block break-all text-base font-bold text-encre group-hover:text-accent-texte">{{ ligne.valeur }}</span>
          </span>
          <UIcon
            v-if="ligne.href"
            name="i-ph-caret-right"
            class="size-5 shrink-0 text-texte-secondaire group-hover:text-accent-texte"
            aria-hidden="true"
          />
        </component>
      </li>
    </ul>
  </div>
</template>
