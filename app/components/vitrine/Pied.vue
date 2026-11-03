<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'

defineProps<{
  vitrine: VitrinePubliqueDTO
  /** Pages Agenda et Contact : une simple ligne, sans répéter les coordonnées. */
  compact?: boolean
}>()
</script>

<template>
  <footer id="contact" class="scroll-mt-24 border-t border-bordure">
    <div
      v-if="compact"
      class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-6 text-(length:--fs-14) text-texte-secondaire"
    >
      <p class="m-0">{{ vitrine.nomAffiche }} · {{ vitrine.ville }}</p>
      <p v-if="vitrine.badgeBrandself" class="m-0">Créé avec Brandself</p>
    </div>
    <div v-else class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 md:flex-row md:items-end md:justify-between">
      <div class="flex flex-col gap-1">
        <h2 class="font-(family-name:--font-titre) text-(length:--fs-16) font-bold">Contact</h2>
        <p class="text-texte-secondaire">{{ vitrine.ville }}, {{ vitrine.paysLibelle }}</p>
        <NuxtLink
          :to="`/${vitrine.username}/contact`"
          class="inline-flex min-h-(--cible-tactile) items-center font-semibold text-accent-texte underline-offset-4 hover:underline"
        >
          Me contacter
        </NuxtLink>
        <a
          v-if="vitrine.contact.email"
          :href="`mailto:${vitrine.contact.email}`"
          class="inline-flex min-h-(--cible-tactile) items-center text-texte-secondaire underline-offset-4 hover:text-accent-texte hover:underline"
        >
          {{ vitrine.contact.email }}
        </a>
        <a
          v-if="vitrine.contact.telephone"
          :href="`tel:${vitrine.contact.telephone}`"
          class="inline-flex min-h-(--cible-tactile) items-center text-texte-secondaire underline-offset-4 hover:text-accent-texte hover:underline"
        >
          {{ vitrine.contact.telephone }}
        </a>
      </div>
      <p v-if="vitrine.badgeBrandself" class="text-(length:--fs-14) text-texte-secondaire">Créé avec Brandself</p>
    </div>
  </footer>
</template>
