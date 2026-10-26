<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'

const props = defineProps<{ photo: MediaDTO | null, prenom: string, nom: string, nomAffiche: string }>()

const initiales = computed(() => `${props.prenom.charAt(0)}${props.nom.charAt(0)}`.toUpperCase())
</script>

<template>
  <div
    class="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-b-3xl bg-accent-doux md:aspect-[4/5] md:max-w-md md:justify-self-end md:rounded-t-full md:rounded-b-3xl"
  >
    <img
      v-if="photo"
      :src="photo.url"
      :srcset="photo.srcset"
      sizes="(min-width: 768px) 28rem, 100vw"
      :width="photo.largeur"
      :height="photo.hauteur"
      :alt="`Portrait de ${nomAffiche}`"
      fetchpriority="high"
      class="size-full object-cover object-top"
    >
    <span
      v-else
      aria-hidden="true"
      class="font-(family-name:--font-titre) text-[length:clamp(6rem,30vw,10rem)] leading-none font-medium text-accent"
    >
      {{ initiales }}
    </span>
  </div>
</template>
