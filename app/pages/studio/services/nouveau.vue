<script setup lang="ts">
import type { Devise } from '#shared/compte'

definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Nouveau service — Brandself' })

const DEVISE_REPLI: Devise = 'XAF'

// Les compteurs (plafond de vedettes) viennent de la liste ; la devise, du compte.
const { compteurs, enChargement: listeEnChargement, enErreur, absente, refresh } = useStudioServices()
const { moi, enChargement: moiEnChargement } = useMoi()

const enChargement = computed(() => listeEnChargement.value || moiEnChargement.value)
const deviseParDefaut = computed<Devise>(() => moi.value?.devise ?? DEVISE_REPLI)
</script>

<template>
  <div>
    <StudioRetour to="/studio/services" label="Services" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Nouveau service
      </h1>
      <div role="status" class="flex flex-col gap-6">
        <span class="sr-only">Chargement du formulaire</span>
        <USkeleton class="h-24 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vous pourrez ajouter des services dès que votre vitrine existera."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !compteurs"
      icon="i-ph-warning-circle"
      title="Le formulaire ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos services sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Nouveau service
      </h1>
      <StudioServiceForm :service="null" :compteurs="compteurs" :devise-par-defaut="deviseParDefaut" />
    </div>
  </div>
</template>
