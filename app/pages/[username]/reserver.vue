<script setup lang="ts">
const route = useRoute()
const username = String(route.params.username)

const [vitrine, { reponse }] = await Promise.all([usePublicVitrine(username), usePublicServices(username)])

const titre = computed(() => `Réserver avec ${vitrine.value.nomAffiche}`)
// Page provisoire (remplacée par la réservation en ligne) : jamais indexée.
useSeoMeta({ title: titre, robots: 'noindex, nofollow' })

const whatsapp = computed(() => lienWhatsapp(vitrine.value.contact.whatsapp, 'Bonjour, je souhaite réserver.'))
const telephone = computed(() => vitrine.value.contact.telephone)
const email = computed(() => vitrine.value.contact.email)
const aucunMoyen = computed(() => whatsapp.value === null && telephone.value === null && email.value === null)
</script>

<template>
  <VitrineCadre :vitrine="vitrine" :services-total="reponse?.total ?? 0">
    <div class="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
        {{ titre }}
      </h1>
      <p class="text-(length:--fs-16) text-texte-secondaire">
        La réservation en ligne arrive très bientôt. En attendant, contactez-moi directement.
      </p>
      <div class="flex flex-col gap-3">
        <UButton v-if="whatsapp" :to="whatsapp" target="_blank" rel="noopener" block icon="i-ph-whatsapp-logo">
          Écrire sur WhatsApp
        </UButton>
        <UButton v-if="telephone" :to="`tel:${telephone}`" variant="outline" block icon="i-ph-phone">
          Appeler
        </UButton>
        <UButton v-if="email" :to="`mailto:${email}`" variant="outline" block icon="i-ph-envelope-simple">
          Écrire un email
        </UButton>
        <p v-if="aucunMoyen" class="text-texte-secondaire">Les moyens de contact seront bientôt disponibles.</p>
      </div>
      <NuxtLink
        :to="`/${vitrine.username}`"
        class="inline-flex min-h-(--cible-tactile) items-center gap-2 self-start text-texte-secondaire hover:text-accent"
      >
        <UIcon name="i-ph-arrow-left" class="size-4" aria-hidden="true" />
        Retour à la vitrine
      </NuxtLink>
    </div>
  </VitrineCadre>
</template>
