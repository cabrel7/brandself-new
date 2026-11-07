<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { OG_IMAGE_DEFAUT, OG_IMAGE_LARGEUR, OG_IMAGE_HAUTEUR } from '#shared/seo'

const { public: { siteUrl = '' } } = useRuntimeConfig()

useSeoMeta({
  title: 'Votre vitrine en ligne',
  description: 'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.',
  ogTitle: `${MARQUE.nom} — votre vitrine en ligne`,
  ogDescription: 'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.',
  ogType: 'website',
  ogUrl: siteUrl || undefined,
  ogImage: [{ url: OG_IMAGE_DEFAUT, width: OG_IMAGE_LARGEUR, height: OG_IMAGE_HAUTEUR, alt: MARQUE.nom }],
  twitterCard: 'summary_large_image',
  twitterImage: OG_IMAGE_DEFAUT,
})

useSchemaOrg([
  {
    '@type': 'Organization',
    name: MARQUE.nom,
    url: siteUrl || undefined,
    logo: '/brand/icone.png',
  },
  {
    '@type': 'WebSite',
    name: MARQUE.nom,
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
