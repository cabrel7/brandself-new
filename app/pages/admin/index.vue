<script setup lang="ts">
import { ADMIN_PREFIXE_API } from '#shared/admin'
import type { VueEnsembleEnrichieDto } from '#shared/schemas/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Vue d’ensemble · Administration' })

const { data, status, error, refresh } = useFetch<VueEnsembleEnrichieDto>(`${ADMIN_PREFIXE_API}/vue-ensemble`, {
  key: 'admin-vue-ensemble',
  server: false,
  lazy: true,
})
useAdminSessionExpiree(error)

// Le squelette n'apparaît qu'après 200 ms : pas de flash sur un chargement rapide.
const { ready: squeletteVisible } = useTimeout(200, { controls: true })
</script>

<template>
  <div v-if="status === 'pending' || status === 'idle'" class="flex flex-col gap-3" aria-busy="true">
    <template v-if="squeletteVisible">
      <USkeleton class="h-6 w-48" />
      <USkeleton class="h-4 w-72 max-w-full" />
      <USkeleton class="h-24 w-full" />
    </template>
  </div>

  <div v-else-if="error || !data" class="flex flex-col items-start gap-4">
    <UAlert
      role="alert"
      color="error"
      variant="soft"
      icon="i-ph-warning-circle"
      description="Nous n’avons pas pu charger la vue d’ensemble."
      class="w-full"
    />
    <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" @click="() => refresh()">
      Réessayer
    </UButton>
  </div>

  <div v-else class="flex flex-col gap-8">
    <h1 class="font-(family-name:--font-titre) text-(length:--fs-24) leading-[1.15] font-bold">
      Bonjour, {{ data.admin.nom }}
    </h1>
    <AlerteVueEnsemble :alertes="data.alertes" />
    <VueEnsembleCompteurs :vue="data" />
  </div>
</template>
