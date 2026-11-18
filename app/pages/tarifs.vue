<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { OG_IMAGE_DEFAUT, OG_IMAGE_HAUTEUR, OG_IMAGE_LARGEUR, ogLocale, urlAbsolue, urlCanonique } from '#shared/seo'

const TITRE_PAGE = 'Tarifs'
const DESCRIPTION_PAGE = 'Un plan gratuit pour commencer, un plan payant quand votre vitrine reçoit des rendez-vous. Paiement par Mobile Money, sans renouvellement automatique.'

// Même source que la page d'accueil : `site.url` (nuxt-site-config), image de marque par défaut, locale du site.
const siteUrl = useSiteConfig().url ?? ''
const imagePartage = urlAbsolue(siteUrl, OG_IMAGE_DEFAUT)

useSeoMeta({
  title: TITRE_PAGE,
  description: DESCRIPTION_PAGE,
  ogTitle: `${TITRE_PAGE} — ${MARQUE.nom}`,
  ogDescription: DESCRIPTION_PAGE,
  ogType: 'website',
  ogLocale: ogLocale(null),
  ogUrl: urlCanonique(siteUrl, '/tarifs'),
  ogImage: [{ url: imagePartage, width: OG_IMAGE_LARGEUR, height: OG_IMAGE_HAUTEUR, alt: MARQUE.nom }],
  twitterCard: 'summary_large_image',
  twitterImage: imagePartage,
})

const source = await useTarifs()
const { erreur, refresh, tarifs, devises, prixPeriodes } = source
const { cartes, itemsDevises, itemsPeriodes, deviseTexte, periodeTexte, moyensTexte } = useTarifsAffichage(source)
</script>

<template>
  <div class="bg-fond text-encre">
    <MarketingEntete />

    <main id="haut" class="bg-surface px-4 py-20 md:px-6 md:py-30">
      <div class="mx-auto w-full max-w-290">
        <UEmpty
          v-if="erreur || !tarifs"
          icon="i-ph-warning-circle"
          title="Les tarifs ne s’affichent pas"
          description="Nous n’avons pas pu les charger. Réessayez dans un instant."
          :as="{ title: 'h1' }"
          :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
        />

        <template v-else>
          <div class="mx-auto mb-10 flex max-w-200 flex-col items-center gap-3 text-center md:mb-12">
            <p class="m-0 text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">
              Tarifs
            </p>
            <h1 class="m-0 text-balance font-(family-name:--font-titre) text-[clamp(2.125rem,4.8vw,3.625rem)] leading-[1.06] font-medium text-encre">
              Un plan gratuit, un plan payant
            </h1>
          </div>

          <div v-if="prixPeriodes.length > 0" class="mx-auto mb-10 flex w-full max-w-md flex-col gap-4 md:mb-12">
            <TarifsSelecteur v-if="devises.length > 1" v-model="deviseTexte" :items="itemsDevises" legende="Devise" fond="fond" />
            <TarifsSelecteur v-model="periodeTexte" :items="itemsPeriodes" legende="Durée de l’abonnement" fond="fond" />
          </div>

          <div class="mx-auto grid max-w-240 items-stretch gap-6 md:grid-cols-2 md:gap-7">
            <MarketingPlanCarte v-for="carte in cartes" :key="carte.id" :carte="carte" :niveau="2" />
          </div>

          <div class="mx-auto mt-8 flex max-w-2xl flex-col gap-2 text-center text-base text-encre">
            <p v-if="moyensTexte" class="m-0">
              Paiement par {{ moyensTexte }}.
            </p>
            <p class="m-0">
              Sans renouvellement automatique.
            </p>
          </div>
        </template>
      </div>
    </main>

    <MarketingPied />
  </div>
</template>
