<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { OG_IMAGE_DEFAUT, OG_IMAGE_HAUTEUR, OG_IMAGE_LARGEUR, SITE_DESCRIPTION, urlAbsolue, urlCanonique } from '#shared/seo'

// `site.url` (nuxt-site-config) : même source que la canonique du module. L'Organization et le WebSite
// viennent de `schemaOrg.identity` (nuxt.config.ts) : rien à déclarer ici.
const siteUrl = useSiteConfig().url ?? ''
const imagePartage = urlAbsolue(siteUrl, OG_IMAGE_DEFAUT)

useSeoMeta({
  title: 'Votre vitrine en ligne',
  description: SITE_DESCRIPTION,
  ogTitle: `${MARQUE.nom} — votre vitrine en ligne`,
  ogDescription: SITE_DESCRIPTION,
  ogType: 'website',
  ogUrl: urlCanonique(siteUrl, '/'),
  ogImage: [{ url: imagePartage, width: OG_IMAGE_LARGEUR, height: OG_IMAGE_HAUTEUR, alt: MARQUE.nom }],
  twitterCard: 'summary_large_image',
  twitterImage: imagePartage,
})
</script>

<template>
  <section>
    <MarketingPromesse />
    <MarketingFonctions />
    <MarketingTarifsResume />
  </section>
</template>
