<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Nouveau témoignage — Brandself' })

// Les compteurs (plafond de vedettes) viennent de la liste du studio.
const { compteurs, enChargement, enErreur, absente, refresh } = useStudioTemoignages()

async function surEnregistrement(): Promise<void> {
  await refresh()
  await navigateTo('/studio/temoignages')
}
</script>

<template>
  <div>
    <StudioRetour to="/studio/temoignages" label="Témoignages" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Nouveau témoignage
      </h1>
      <div role="status" class="flex flex-col gap-6">
        <span class="sr-only">Chargement du formulaire</span>
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vous pourrez ajouter des témoignages dès que votre vitrine existera."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !compteurs"
      icon="i-ph-warning-circle"
      title="Le formulaire ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos témoignages sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Nouveau témoignage
      </h1>
      <StudioTemoignageForm :temoignage="null" :compteurs="compteurs" @enregistrement="surEnregistrement" />
    </div>
  </div>
</template>
