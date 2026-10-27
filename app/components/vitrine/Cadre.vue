<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'

const props = defineProps<{
  vitrine: VitrinePubliqueDTO
  /** Réserve la place d'une barre d'action fixe en bas de l'écran (mobile). */
  barreBasse?: boolean
}>()

// Le fond (<body>) suit la palette : l'attribut doit être sur <html>, pas seulement sur la racine.
useHead({ htmlAttrs: { 'data-palette': () => props.vitrine.palette, 'lang': 'fr' } })

const contenus = usePublicContenus(props.vitrine.username)
</script>

<template>
  <div :data-palette="vitrine.palette" class="min-h-screen bg-fond text-encre" :class="{ 'pb-24 lg:pb-0': barreBasse }">
    <VitrineNav :nom-affiche="vitrine.nomAffiche" :username="vitrine.username" :contenus="contenus" />
    <main>
      <slot />
    </main>
    <VitrinePied :vitrine="vitrine" />
  </div>
</template>
