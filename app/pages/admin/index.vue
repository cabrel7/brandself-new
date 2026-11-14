<script setup lang="ts">
import { ADMIN_PREFIXE_API } from '#shared/admin'
import type { VueEnsembleDto } from '#shared/schemas/admin'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Vue d’ensemble · Administration' })

const { expirer } = useAdminSession()

const { data, status, error, refresh } = useFetch<VueEnsembleDto>(`${ADMIN_PREFIXE_API}/vue-ensemble`, {
  key: 'admin-vue-ensemble',
  server: false,
  lazy: true,
})

// Le squelette n'apparaît qu'après 200 ms : pas de flash sur un chargement rapide.
const { ready: squeletteVisible } = useTimeout(200, { controls: true })

// Session refusée en cours d'usage (404 uniforme du serveur) : retour à la connexion.
watch(error, (erreur) => {
  if (lireErreurApi(erreur).statut === 404) void expirer()
})
</script>

<template>
  <div v-if="status === 'pending' || status === 'idle'" class="flex flex-col gap-3" aria-busy="true">
    <template v-if="squeletteVisible">
      <USkeleton class="h-6 w-48" />
      <USkeleton class="h-4 w-72 max-w-full" />
    </template>
  </div>

  <div v-else-if="error" class="flex flex-col items-start gap-4">
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

  <UEmpty
    v-else-if="data"
    icon="i-ph-gauge"
    :title="`Bonjour, ${data.admin.nom}`"
    description="Les indicateurs seront affichés ici."
  />
</template>
