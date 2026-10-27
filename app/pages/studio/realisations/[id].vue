<script setup lang="ts">
definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Modifier la réalisation — Brandself' })

const route = useRoute()
const id = String(route.params.id)

const { realisation, compteurs, enChargement, enErreur, introuvable, sansVitrine, refresh } = useStudioRealisation(id)
</script>

<template>
  <div>
    <StudioRetour to="/studio/realisations" label="Réalisations" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Modifier la réalisation
      </h1>
      <div role="status" class="flex flex-col gap-6">
        <span class="sr-only">Chargement de la réalisation</span>
        <USkeleton class="aspect-[2/1] w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
      </div>
    </div>

    <UEmpty
      v-else-if="introuvable"
      icon="i-ph-squares-four"
      title="Cette réalisation n’existe plus"
      description="Elle a peut-être été supprimée depuis un autre appareil."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Retour aux réalisations', to: '/studio/realisations', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="sansVitrine"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos réalisations apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !realisation || !compteurs"
      icon="i-ph-warning-circle"
      title="Cette réalisation ne s’affiche pas"
      description="Nous n’avons pas pu la charger. Vos réalisations sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Modifier la réalisation
      </h1>
      <StudioRealisationForm :realisation="realisation" :compteurs="compteurs" />
    </div>
  </div>
</template>
