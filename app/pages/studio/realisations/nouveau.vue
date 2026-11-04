<script setup lang="ts">
definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Nouvelle réalisation — Brandself' })

// Les compteurs (plafond de vedettes) viennent de la liste.
const { compteurs, enChargement, enErreur, absente, refresh } = useStudioRealisations()
</script>

<template>
  <div>
    <StudioRetour to="/studio/realisations" label="Réalisations" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Nouvelle réalisation
      </h1>
      <div role="status" class="flex flex-col gap-6">
        <span class="sr-only">Chargement du formulaire</span>
        <USkeleton class="aspect-[2/1] w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vous pourrez ajouter des réalisations dès que votre vitrine existera."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !compteurs"
      icon="i-ph-warning-circle"
      title="Le formulaire ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos réalisations sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Nouvelle réalisation
      </h1>
      <StudioLimitePlanMessage
        v-if="compteurs.limitePlan.atteinte"
        ressource="realisations"
        :limite="compteurs.limitePlan.limite"
      />
      <StudioRealisationForm v-else :realisation="null" :compteurs="compteurs" />
    </div>
  </div>
</template>
