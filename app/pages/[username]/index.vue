<script setup lang="ts">
const route = useRoute()
const username = String(route.params.username)

// Lancés ensemble : les deux lectures partent avant le premier await.
const [vitrine, { reponse: services }] = await Promise.all([usePublicVitrine(username), usePublicServices(username)])

useSeoMeta({
  title: () => vitrine.value.seo.titre,
  description: () => vitrine.value.seo.description,
  ogTitle: () => vitrine.value.seo.titre,
  ogDescription: () => vitrine.value.seo.description,
})

const total = computed(() => services.value?.total ?? 0)
const aLaUne = computed(() => services.value?.aLaUne ?? [])
</script>

<template>
  <VitrineCadre :vitrine="vitrine" :services-total="total">
    <VitrineHero :vitrine="vitrine" />
    <VitrineServicesALaUne v-if="total > 0 && aLaUne.length > 0" :username="vitrine.username" :services="aLaUne" :total="total" />
  </VitrineCadre>
</template>
