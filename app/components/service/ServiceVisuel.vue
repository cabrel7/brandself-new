<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { initialeDuTitre } from '#shared/services'

const props = defineProps<{ image: MediaDTO | null, titre: string, hauteur: 'carte' | 'detail' }>()

const TAILLES = {
  carte: '(min-width: 1024px) 33vw, (min-width: 768px) 45vw, 85vw',
  detail: '(min-width: 1024px) 50vw, 100vw',
} as const

const initiale = computed(() => initialeDuTitre(props.titre))
const detail = computed(() => props.hauteur === 'detail')
</script>

<template>
  <div
    class="relative w-full overflow-hidden bg-accent-doux"
    :class="detail ? 'aspect-[16/10] lg:rounded-(--rayon-carte)' : 'h-52'"
  >
    <img
      v-if="image"
      :src="image.url"
      :srcset="image.srcset"
      :sizes="TAILLES[hauteur]"
      :width="image.largeur"
      :height="image.hauteur"
      :alt="`Photo du service ${titre}`"
      :loading="detail ? undefined : 'lazy'"
      :fetchpriority="detail ? 'high' : undefined"
      class="size-full object-cover"
    >
    <div v-else aria-hidden="true" class="size-full bg-accent">
      <span class="absolute -top-12 -right-12 size-44 rounded-full bg-fond/20" />
      <span class="absolute bottom-0 left-6 font-(family-name:--font-titre) text-(length:--fs-initiale) leading-none font-medium text-fond">
        {{ initiale }}
      </span>
    </div>
  </div>
</template>
