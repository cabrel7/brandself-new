<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'

const props = defineProps<{ photo: MediaDTO | null, prenom: string, nom: string, nomAffiche: string }>()

const initiales = computed(() => `${props.prenom.charAt(0)}${props.nom.charAt(0)}`.toUpperCase())
</script>

<template>
  <div
    class="fondu-bas md:fondu-cotes relative flex aspect-square w-full items-center justify-center overflow-hidden bg-accent-doux md:aspect-[4/5] md:max-w-xl md:justify-self-end"
  >
    <img
      v-if="photo"
      :src="photo.url"
      :srcset="photo.srcset"
      sizes="(min-width: 768px) 36rem, 100vw"
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
