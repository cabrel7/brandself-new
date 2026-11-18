<script setup lang="ts">
const props = defineProps<{
  /** Logo de la plateforme : affiché seulement quand le badge « Propulsé par » l’est. */
  logo: boolean
  /** Adresse absolue de la page de liens. */
  url: string
  titre: string
}>()

const { message, partager } = usePartagePage({ url: () => props.url, titre: () => props.titre })
</script>

<template>
  <!-- Téléphone : posé sur le portrait. Dès 768 px : barre en tête des deux colonnes. -->
  <header class="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 pt-4 md:static md:col-span-2 md:px-0 md:py-6">
    <!-- Même composant et même taille que l'en-tête de la landing (`BsLogo` horizontal, h-10). -->
    <span v-if="logo" class="inline-flex items-center rounded-full bg-fond px-4 py-2">
      <BsLogo variante="horizontal" class="h-10" />
    </span>
    <span v-else aria-hidden="true" />

    <div class="relative">
      <button
        type="button"
        class="inline-flex min-h-(--cible-tactile) cursor-pointer items-center gap-2 rounded-full border border-bordure bg-fond px-4 text-(length:--fs-16) font-medium text-encre transition-colors hover:bg-accent-doux focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
        @click="partager"
      >
        <UIcon name="i-ph-share-network" class="size-5" aria-hidden="true" />
        Partager
      </button>
      <p
        role="status"
        :class="message ? 'absolute top-full right-0 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-(--rayon-interne) bg-encre px-3 py-2 text-(length:--fs-14) text-fond' : 'sr-only'"
      >
        {{ message }}
      </p>
    </div>
  </header>
</template>
