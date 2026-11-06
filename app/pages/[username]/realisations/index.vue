<script setup lang="ts">
const route = useRoute()
const username = String(route.params.username)
const { public: { siteUrl = '' } } = useRuntimeConfig()

const [vitrine, { reponse, erreur }] = await Promise.all([usePublicVitrine(username), usePublicRealisations(username)])

if (erreur.value) throw erreurPagePublique(erreur.value)
// Une page n'existe que si elle a du contenu : sans réalisation visible, 404.
if (!reponse.value || reponse.value.total === 0) throw erreurPagePublique({ statusCode: 404 })

useSeoVitrine({
  vitrine: {
    username: vitrine.value.username,
    nomAffiche: vitrine.value.nomAffiche,
    metier: vitrine.value.metier,
    ville: vitrine.value.ville,
    pays: vitrine.value.pays,
    paysLibelle: vitrine.value.paysLibelle,
    titre: vitrine.value.titre,
    seoTitre: vitrine.value.seo.titre,
    seoDescription: vitrine.value.seo.description,
    accroche: vitrine.value.accroche,
    bio: vitrine.value.bio,
    photo: vitrine.value.photo,
    liens: [],
  },
  page: 'realisations',
  siteUrl,
})

const realisations = computed(() => reponse.value?.realisations ?? [])
const fil = computed(() => [{ label: 'Accueil', to: `/${vitrine.value.username}` }, { label: 'Réalisations' }])
</script>

<template>
  <VitrineCadre :vitrine="vitrine">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 md:py-12">
      <div class="flex flex-col gap-4">
        <UBreadcrumb :items="fil" />
        <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
          Mes réalisations
        </h1>
        <p class="max-w-prose text-(length:--fs-16) text-texte-secondaire">
          Quelques projets qui montrent ma façon de travailler.
        </p>
      </div>
      <ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="realisation in realisations" :key="realisation.slug">
          <RealisationCarte :realisation="realisation" :username="vitrine.username" />
        </li>
      </ul>
    </div>
  </VitrineCadre>
</template>
