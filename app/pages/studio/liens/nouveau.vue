<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Nouveau lien — Brandself' })

const { enChargement, enErreur, absente, refresh } = useStudioLiens()

async function apresEnregistrement(): Promise<void> {
  await refresh()
  await navigateTo('/studio/liens')
}
</script>

<template>
  <div>
    <StudioRetour to="/studio/liens" label="Liens" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">Nouveau lien</h1>
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
      description="Vous pourrez ajouter des liens dès que votre vitrine existera."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Le formulaire ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos liens sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">Nouveau lien</h1>
      <StudioLienForm :lien="null" @enregistrement="apresEnregistrement" />
    </div>
  </div>
</template>
