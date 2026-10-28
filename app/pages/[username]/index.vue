<script setup lang="ts">
const route = useRoute()
const username = String(route.params.username)

// Lancés ensemble : les trois lectures partent avant le premier await.
const [vitrine, { reponse: services }, { reponse: realisations }, { reponse: temoignages }] = await Promise.all([
  usePublicVitrine(username),
  usePublicServices(username),
  usePublicRealisations(username),
  usePublicTemoignages(username),
])

useSeoMeta({
  title: () => vitrine.value.seo.titre,
  description: () => vitrine.value.seo.description,
  ogTitle: () => vitrine.value.seo.titre,
  ogDescription: () => vitrine.value.seo.description,
})

const total = computed(() => services.value?.total ?? 0)
const aLaUne = computed(() => services.value?.aLaUne ?? [])
const realisationsTotal = computed(() => realisations.value?.total ?? 0)
// L'accueil ne met en avant qu'une réalisation (la première à la une).
const realisationALaUne = computed(() => realisations.value?.aLaUne[0] ?? null)
const temoignagesTotal = computed(() => temoignages.value?.total ?? 0)
</script>

<template>
  <VitrineCadre :vitrine="vitrine">
    <VitrineHero :vitrine="vitrine" />
    <VitrineServicesALaUne v-if="total > 0 && aLaUne.length > 0" :username="vitrine.username" :services="aLaUne" :total="total" />
    <VitrineALaUne
      v-if="realisationsTotal > 0 && realisationALaUne"
      :username="vitrine.username"
      :realisation="realisationALaUne"
      :realisations-total="realisationsTotal"
    />
    <VitrineTemoignageALaUne v-if="temoignagesTotal > 0" :username="vitrine.username" />
  </VitrineCadre>
</template>
