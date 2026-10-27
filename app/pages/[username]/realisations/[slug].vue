<script setup lang="ts">
import { realisationsHref, surtitreRealisation } from '#shared/realisations'

const route = useRoute()
const username = String(route.params.username)
const slug = String(route.params.slug)

const [vitrine, reponse] = await Promise.all([usePublicVitrine(username), usePublicRealisation(username, slug)])

const realisation = computed(() => reponse.value.realisation)

useSeoMeta({
  title: () => realisation.value.seo.titre,
  description: () => realisation.value.seo.description,
  ogTitle: () => realisation.value.seo.titre,
  ogDescription: () => realisation.value.seo.description,
})

// Pas de type CreativeWork dédié dans le module : nœud brut. L'image absolue viendra avec l'URL du site (S12).
useSchemaOrg([
  {
    '@type': 'CreativeWork',
    'name': () => realisation.value.titre,
    'description': () => realisation.value.seo.description,
    'creator': { '@type': 'Person', 'name': vitrine.value.nomAffiche },
    ...(realisation.value.annee !== null ? { dateCreated: String(realisation.value.annee) } : {}),
  },
])
</script>

<template>
  <VitrineCadre :vitrine="vitrine">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 py-4 lg:px-6 lg:py-8">
      <NuxtLink
        :to="realisationsHref(vitrine.username)"
        class="inline-flex min-h-(--cible-tactile) items-center gap-2 self-start px-6 text-texte-secondaire hover:text-accent lg:px-0"
      >
        <UIcon name="i-ph-arrow-left" class="size-4" aria-hidden="true" />
        Toutes les réalisations
      </NuxtLink>

      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <article class="flex flex-col gap-6">
          <RealisationVisuel :image="realisation.image" :titre="realisation.titre" format="detail" />

          <div class="flex flex-col gap-4 px-6 lg:px-0">
            <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">
              {{ surtitreRealisation(realisation.annee) }}
            </p>
            <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
              {{ realisation.titre }}
            </h1>

            <div class="lg:hidden">
              <RealisationFaits :annee="realisation.annee" :lieu="realisation.lieu" :role="realisation.role" />
            </div>

            <p v-if="realisation.description" class="max-w-prose text-(length:--fs-16) whitespace-pre-line text-texte-secondaire">
              {{ realisation.description }}
            </p>
          </div>

          <div class="flex flex-col gap-6 px-6 lg:px-0">
            <RealisationGalerie :images="realisation.galerie" :titre="realisation.titre" />

            <UButton
              v-if="realisation.lien"
              :to="realisation.lien"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="lg"
              block
              trailing-icon="i-ph-arrow-square-out"
              class="lg:hidden"
            >
              Voir le projet<span class="sr-only"> (nouvel onglet)</span>
            </UButton>
          </div>
        </article>

        <aside aria-label="Informations sur la réalisation" class="hidden lg:block">
          <div class="flex flex-col gap-5 rounded-(--rayon-carte) border border-bordure bg-surface p-6 lg:sticky lg:top-6">
            <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">En bref</p>
            <RealisationFaits :annee="realisation.annee" :lieu="realisation.lieu" :role="realisation.role" />
            <UButton
              v-if="realisation.lien"
              :to="realisation.lien"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              block
              trailing-icon="i-ph-arrow-square-out"
            >
              Voir le projet<span class="sr-only"> (nouvel onglet)</span>
            </UButton>
          </div>
        </aside>
      </div>

      <div class="flex flex-col gap-8 px-6 lg:px-0">
        <RealisationAutres :autres="reponse.autres" :total="reponse.total" :username="vitrine.username" />
        <RealisationAppel :username="vitrine.username" />
      </div>
    </div>
  </VitrineCadre>
</template>
