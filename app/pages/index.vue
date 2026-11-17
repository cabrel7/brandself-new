<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { OG_IMAGE_DEFAUT, OG_IMAGE_HAUTEUR, OG_IMAGE_LARGEUR, SITE_DESCRIPTION, ogLocale, urlAbsolue, urlCanonique } from '#shared/seo'

const MARGE_HYDRATATION_COMPRIS = '600px'

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
  ogLocale: ogLocale(null),
  ogUrl: urlCanonique(siteUrl, '/'),
  ogImage: [{ url: imagePartage, width: OG_IMAGE_LARGEUR, height: OG_IMAGE_HAUTEUR, alt: MARQUE.nom }],
  twitterCard: 'summary_large_image',
  twitterImage: imagePartage,
})

// Défilement doux et décalage des ancres sous la barre fixe : portés par `<html>` le temps de cette page seulement.
useHead({ htmlAttrs: { class: 'page-accueil' } })
</script>

<template>
  <div class="bg-fond text-encre">
    <MarketingEntete />
    <main id="haut">
      <MarketingHero />
      <!-- Sous la ligne de flottaison : HTML rendu par le serveur (SEO, lecture sans JS), JS hydraté à l'entrée à l'écran.
           Un lien d'ancre fait défiler jusqu'à la cible, ce qui déclenche l'hydratation. La FAQ (`details` natifs) n'a besoin d'aucun JS. -->
      <LazyMarketingTrouve hydrate-on-visible />
      <!-- Compris masque ses étapes (CSS) jusqu'à son hydratation : elle démarre avant l'entrée à l'écran pour ne jamais montrer un vide. -->
      <LazyMarketingCompris :hydrate-on-visible="{ rootMargin: MARGE_HYDRATATION_COMPRIS }" />
      <LazyMarketingContact hydrate-on-visible />
      <LazyMarketingPourQui hydrate-on-visible />
      <LazyMarketingTarifs hydrate-on-visible />
      <LazyMarketingFaq hydrate-never />
      <LazyMarketingCloture hydrate-on-visible />
    </main>
    <!-- Pied : uniquement des liens (`<a>` natifs), aucun état : jamais hydraté. -->
    <LazyMarketingPied hydrate-never />
  </div>
</template>

<style>
html.page-accueil {
  scroll-padding-top: 5.25rem;
}

@media (prefers-reduced-motion: no-preference) {
  html.page-accueil {
    scroll-behavior: smooth;
  }
}
</style>
