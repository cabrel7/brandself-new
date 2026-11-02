<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Modifier le témoignage — Brandself' })

const route = useRoute()
const slug = String(route.params.slug)

const { temoignage, enChargement, enErreur, introuvable, refresh: refreshTemoignage } = useStudioTemoignage(slug)
// Le GET détail ne renvoie pas les compteurs : le plafond de vedettes vient de la liste.
const {
  compteurs,
  enChargement: enChargementListe,
  enErreur: enErreurListe,
  absente: listeAbsente,
  refresh: refreshListe,
} = useStudioTemoignages()

async function surEnregistrement(): Promise<void> {
  await refreshListe()
  await navigateTo('/studio/temoignages')
}
</script>

<template>
  <div>
    <StudioRetour to="/studio/temoignages" label="Témoignages" />

    <div v-if="enChargement || enChargementListe" class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Modifier le témoignage
      </h1>
      <div role="status" class="flex flex-col gap-6">
        <span class="sr-only">Chargement du témoignage</span>
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-14 w-full" aria-hidden="true" />
        <USkeleton class="h-32 w-full" aria-hidden="true" />
      </div>
    </div>

    <UEmpty
      v-else-if="listeAbsente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos témoignages apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="introuvable"
      icon="i-ph-chat-centered-text"
      title="Ce témoignage n’existe plus"
      description="Il a peut-être été supprimé depuis un autre appareil."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Retour aux témoignages', to: '/studio/temoignages', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !temoignage"
      icon="i-ph-warning-circle"
      title="Ce témoignage ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos témoignages sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refreshTemoignage() }]"
    />

    <UEmpty
      v-else-if="enErreurListe || !compteurs"
      icon="i-ph-warning-circle"
      title="Vos témoignages ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Vos témoignages sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refreshListe() }]"
    />

    <div v-else class="mt-4 flex flex-col gap-6">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
        Modifier le témoignage
      </h1>
      <StudioTemoignageForm :temoignage="temoignage" :compteurs="compteurs" @enregistrement="surEnregistrement" />
    </div>
  </div>
</template>
