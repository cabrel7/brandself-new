<script setup lang="ts">
const { public: { siteUrl = '' } } = useRuntimeConfig()

useSeoMeta({
  title: 'Brandself — votre vitrine en ligne',
  description: 'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.',
  ogTitle: 'Brandself — votre vitrine en ligne',
  ogDescription: 'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.',
  ogType: 'website',
  ogUrl: siteUrl || undefined,
  twitterCard: 'summary_large_image',
})

useSchemaOrg([
  {
    '@type': 'Organization',
    name: 'Brandself',
    url: siteUrl || undefined,
    logo: '/og/brandself-logo.png',
  },
  {
    '@type': 'WebSite',
    name: 'Brandself',
    url: siteUrl || undefined,
  },
])
</script>

<template>
  <section>
    <Promesse />
    <Fonctions />
    <TarifsResume />
  </section>
</template>
