<script setup lang="ts">
const route = useRoute()
const vitrine = await usePublicVitrine(String(route.params.username))

useSeoMeta({
  title: () => vitrine.value.seo.titre,
  description: () => vitrine.value.seo.description,
  ogTitle: () => vitrine.value.seo.titre,
  ogDescription: () => vitrine.value.seo.description,
})

// Le fond (<body>) suit la palette : l'attribut doit être sur <html>, pas seulement sur la racine.
useHead({ htmlAttrs: { 'data-palette': () => vitrine.value.palette, 'lang': 'fr' } })
</script>

<template>
  <div :data-palette="vitrine.palette" class="min-h-screen bg-fond text-encre">
    <VitrineNav :nom-affiche="vitrine.nomAffiche" />
    <main>
      <VitrineHero :vitrine="vitrine" />
    </main>
    <VitrinePied :vitrine="vitrine" />
  </div>
</template>
