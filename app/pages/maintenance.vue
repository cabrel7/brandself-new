<script setup lang="ts">
import { ETAT_PUBLIC_CHEMIN } from '#shared/admin'
import { MARQUE } from '#shared/brand'
import type { EtatPublicDto } from '#shared/schemas/admin-a4'

// A4 (D-A4-08) : page d'état pendant une maintenance. Elle relit l'état toutes les 30 secondes et ramène le visiteur
// au studio dès que la maintenance prend fin, sans rechargement. Le message de l'administrateur est du texte brut.
const INTERVALLE_RELECTURE_MS = 30_000
const CHEMIN_RETOUR = '/studio'
const MESSAGE_PAR_DEFAUT = 'Nous effectuons une opération de maintenance. La connexion et le studio reviennent dans quelques instants.'

useSeoMeta({ title: `Maintenance · ${MARQUE.nom}`, robots: 'noindex, nofollow' })

const { data, status, error, refresh } = useFetch<EtatPublicDto>(ETAT_PUBLIC_CHEMIN, {
  key: 'etat-public',
  server: false,
  lazy: true,
})

const verification = computed(() => status.value === 'pending')
const message = computed(() => {
  const texte = data.value?.message?.trim()
  return texte ? texte : MESSAGE_PAR_DEFAUT
})

async function relire(): Promise<void> {
  await refresh()
  if (data.value?.maintenance === false) await navigateTo(CHEMIN_RETOUR, { replace: true })
}

useIntervalFn(relire, INTERVALLE_RELECTURE_MS)
</script>

<template>
  <main class="mx-auto flex min-h-screen w-full max-w-120 flex-col justify-center gap-6 px-6 py-12">
    <UIcon name="i-ph-wrench" class="size-10 text-texte-secondaire" aria-hidden="true" />
    <h1 class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold text-encre">
      Maintenance en cours
    </h1>
    <p class="m-0 text-(length:--fs-16) break-words text-encre">
      {{ message }}
    </p>
    <p class="m-0 text-base text-texte-secondaire">
      Les vitrines publiques restent accessibles.
    </p>
    <UAlert
      v-if="error"
      role="alert"
      color="neutral"
      variant="outline"
      icon="i-ph-warning"
      description="Nous n’avons pas pu vérifier l’état du service. Réessayez dans un instant."
    />
    <UButton
      size="lg"
      icon="i-ph-arrow-clockwise"
      class="min-h-(--cible-tactile) justify-center self-start max-sm:w-full"
      :loading="verification"
      @click="relire"
    >
      Vérifier maintenant
    </UButton>
  </main>
</template>
