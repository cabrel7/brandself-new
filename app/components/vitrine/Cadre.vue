<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'

const props = defineProps<{
  vitrine: VitrinePubliqueDTO
  /** Réserve la place d'une barre d'action fixe en bas de l'écran (mobile). */
  barreBasse?: boolean
  /** Page de liens autonome (maquette Link-in-bio) : sans barre de navigation. */
  sansNav?: boolean
  /** Page de liens autonome : simple mention « Créé avec Brandself », sans bloc contact. */
  piedMinimal?: boolean
}>()

// Le fond (<body>) suit la palette : l'attribut doit être sur <html>, pas seulement sur la racine.
useHead({ htmlAttrs: { 'data-palette': () => props.vitrine.palette, 'lang': 'fr' } })

const contenus = usePublicContenus(props.vitrine.username)
</script>

<template>
  <div
    :data-palette="vitrine.palette"
    class="bg-fond text-encre"
    :class="{
      'min-h-screen': !piedMinimal,
      'flex min-h-dvh flex-col': piedMinimal,
      'pb-24 lg:pb-0': barreBasse,
    }"
  >
    <VitrineNav v-if="!sansNav" :nom-affiche="vitrine.nomAffiche" :username="vitrine.username" :contenus="contenus" />
    <main :class="{ 'flex-1': piedMinimal }">
      <slot />
    </main>
    <VitrinePied v-if="!piedMinimal" :vitrine="vitrine" />
    <p v-else class="m-0 px-6 py-10 text-center text-(length:--fs-14) text-texte-secondaire">
      Créé avec Brandself
    </p>
  </div>
</template>
