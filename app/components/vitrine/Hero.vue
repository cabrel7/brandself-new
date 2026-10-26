<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'

const props = defineProps<{ vitrine: VitrinePubliqueDTO }>()

const surtitre = computed(() => `${props.vitrine.metier} · ${props.vitrine.ville}`)

const lienWhatsapp = computed(() => {
  const chiffres = props.vitrine.contact.whatsapp?.replace(/\D/g, '')
  return chiffres ? `https://wa.me/${chiffres}` : null
})
</script>

<template>
  <section class="mx-auto grid w-full max-w-6xl items-center gap-8 pb-12 md:grid-cols-2 md:gap-12 md:px-6 md:py-16">
    <VitrinePhoto
      :photo="vitrine.photo"
      :prenom="vitrine.prenom"
      :nom="vitrine.nom"
      :nom-affiche="vitrine.nomAffiche"
      class="md:order-2"
    />
    <div class="flex flex-col gap-4 px-6 md:order-1 md:px-0">
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent uppercase">{{ surtitre }}</p>
      <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
        {{ vitrine.accroche ?? vitrine.nomAffiche }}
      </h1>
      <p v-if="vitrine.bio" class="max-w-prose text-(length:--fs-16) whitespace-pre-line text-texte-secondaire">
        {{ vitrine.bio }}
      </p>
      <div class="mt-2 flex flex-col gap-3 sm:flex-row">
        <UButton to="#contact" block class="sm:w-auto">Me contacter</UButton>
        <UButton
          v-if="lienWhatsapp"
          :to="lienWhatsapp"
          target="_blank"
          rel="noopener"
          variant="outline"
          block
          class="sm:w-auto"
          icon="i-ph-whatsapp-logo"
        >
          Écrire sur WhatsApp
        </UButton>
      </div>
    </div>
  </section>
</template>
