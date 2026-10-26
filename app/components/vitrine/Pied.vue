<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'

defineProps<{ vitrine: VitrinePubliqueDTO }>()
</script>

<template>
  <footer id="contact" class="scroll-mt-4 border-t border-bordure">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 md:flex-row md:items-end md:justify-between">
      <div class="flex flex-col gap-1">
        <h2 class="font-(family-name:--font-titre) text-(length:--fs-16) font-bold">Contact</h2>
        <p class="text-texte-secondaire">{{ vitrine.ville }}, {{ vitrine.paysLibelle }}</p>
        <a
          v-if="vitrine.contact.email"
          :href="`mailto:${vitrine.contact.email}`"
          class="inline-flex min-h-(--cible-tactile) items-center text-texte-secondaire underline-offset-4 hover:text-accent hover:underline"
        >
          {{ vitrine.contact.email }}
        </a>
        <a
          v-if="vitrine.contact.telephone"
          :href="`tel:${vitrine.contact.telephone}`"
          class="inline-flex min-h-(--cible-tactile) items-center text-texte-secondaire underline-offset-4 hover:text-accent hover:underline"
        >
          {{ vitrine.contact.telephone }}
        </a>
      </div>
      <p class="text-(length:--fs-14) text-texte-secondaire">Créé avec Brandself</p>
    </div>
  </footer>
</template>
