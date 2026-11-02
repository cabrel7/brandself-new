<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Modifier le lien — Brandself' })

const route = useRoute()
const id = String(route.params.id)

const { lien, enChargement, enErreur, introuvable, refresh } = useStudioLien(id)

const suppressionOuverte = ref(false)
const suppressionEnCours = ref(false)
const suppressionErreur = ref('')

async function supprimer(): Promise<void> {
  if (suppressionEnCours.value) return
  suppressionErreur.value = ''
  suppressionEnCours.value = true
  try {
    await $fetch(`/api/studio/liens/${id}`, { method: 'DELETE' })
    await navigateTo('/studio/liens')
  }
  catch {
    suppressionErreur.value = 'Nous n’avons pas pu supprimer ce lien. Réessayez dans un instant.'
  }
  finally {
    suppressionEnCours.value = false
  }
}
</script>

<template>
  <div>
    <StudioRetour to="/studio/liens" label="Liens" />

    <UEmpty
      v-if="introuvable"
      icon="i-ph-warning-circle"
      title="Ce lien est introuvable"
      description="Il a peut-être été supprimé ou son identifiant est invalide."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Retour aux liens', to: '/studio/liens', size: 'xl' }]"
    />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">Modifier le lien</h1>
      <div role="status" class="flex flex-col gap-6">
        <span class="sr-only">Chargement du formulaire</span>
        <USkeleton class="h-24 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
      </div>
    </div>

    <UEmpty v-else-if="enErreur" icon="i-ph-warning-circle" title="Le lien ne s’affiche pas" description="Nous n’avons pas pu le charger. Votre lien est intact." :as="{ title: 'h1' }" :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]" />

    <div v-else-if="lien" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">Modifier le lien</h1>
      <StudioLienForm :lien="lien" @enregistrement="refresh" @suppression="suppressionOuverte = true" />
    </div>

    <UModal
      v-if="lien"
      v-model:open="suppressionOuverte"
      :title="`Supprimer « ${lien.libelle} » ?`"
      description="Il disparaîtra de votre page de liens. Cette action est définitive."
      :dismissible="!suppressionEnCours"
    >
      <template #footer="{ close }">
        <div class="flex w-full flex-col gap-3">
          <p v-if="suppressionErreur" role="alert" class="message-erreur m-0">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ suppressionErreur }}</span>
          </p>
          <div class="flex flex-col gap-2 sm:flex-row-reverse">
            <UButton label="Supprimer" color="error" :loading="suppressionEnCours" @click="supprimer" />
            <UButton label="Annuler" variant="outline" color="neutral" :disabled="suppressionEnCours" @click="close" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
