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

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6" aria-busy="true" aria-label="Chargement du formulaire">
      <USkeleton class="h-10 w-56" />
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
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

    <StudioServiceForm v-else class="mt-4" :service="null" :compteurs="compteurs" :devise-par-defaut="deviseParDefaut" />
  </div>
</template>
