<script setup lang="ts">
import type { Devise } from '#shared/compte'

definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Modifier le service — Brandself' })

const DEVISE_REPLI: Devise = 'XAF'

const route = useRoute()
const id = String(route.params.id)

const { service, compteurs, enChargement: serviceEnChargement, enErreur, introuvable, sansVitrine, refresh } = useStudioService(id)
const { moi, enChargement: moiEnChargement } = useMoi()

const enChargement = computed(() => serviceEnChargement.value || moiEnChargement.value)
const deviseParDefaut = computed<Devise>(() => moi.value?.devise ?? DEVISE_REPLI)
</script>

<template>
  <div>
    <StudioRetour to="/studio/services" label="Services" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6" aria-busy="true" aria-label="Chargement du service">
      <USkeleton class="h-10 w-56" />
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
    </div>

    <UEmpty
      v-else-if="introuvable"
      icon="i-ph-briefcase"
      title="Ce service n’existe plus"
      description="Il a peut-être été supprimé depuis un autre appareil."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Retour aux services', to: '/studio/services', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="sansVitrine"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos services apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !service || !compteurs"
      icon="i-ph-warning-circle"
      title="Ce service ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos services sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <StudioServiceForm v-else class="mt-4" :service="service" :compteurs="compteurs" :devise-par-defaut="deviseParDefaut" />
  </div>
</template>
