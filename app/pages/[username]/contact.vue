<script setup lang="ts">
const SOUS_TITRE = 'Une question avant de réserver ? Écrivez-moi, je vous réponds dès que possible.'

const route = useRoute()
const username = String(route.params.username)
const vitrine = await usePublicVitrine(username)

useSeoMeta({
  title: () => `Me contacter — ${vitrine.value.nomAffiche}`,
  robots: 'noindex, nofollow',
})
</script>

<template>
  <VitrineCadre :vitrine="vitrine" pied-compact>
    <div class="mx-auto w-full max-w-6xl px-6 py-8 md:py-12 xl:py-16">
      <nav class="mb-4 hidden text-(length:--fs-14) text-texte-secondaire xl:block" aria-label="Fil d’Ariane">
        <NuxtLink :to="`/${vitrine.username}`" class="hover:text-accent-texte">Accueil</NuxtLink>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Contact</span>
      </nav>

      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">Me contacter</h1>
        <p class="m-0 mt-3 max-w-xl text-base text-texte-secondaire xl:hidden">{{ SOUS_TITRE }}</p>
      </header>

      <div class="mt-10 grid items-start gap-10 xl:mt-8 xl:grid-cols-2 xl:gap-16">
        <div class="flex flex-col gap-6">
          <p class="m-0 hidden max-w-xl text-base text-texte-secondaire xl:block">{{ SOUS_TITRE }}</p>
          <ContactInfos :vitrine="vitrine" />
        </div>
        <ContactMessageForm
          :username="vitrine.username"
          :professionnel="vitrine.nomAffiche"
          class="xl:sticky xl:top-24"
        />
      </div>
    </div>
  </VitrineCadre>
</template>
