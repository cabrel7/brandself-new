<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'

const props = defineProps<{ image: MediaDTO | null, titre: string, format: 'carte' | 'a-la-une' | 'detail' | 'miniature' }>()

const TAILLES = {
  'carte': '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  'a-la-une': '(min-width: 768px) 50vw, 100vw',
  'detail': '(min-width: 1024px) 50vw, 100vw',
  'miniature': '64px',
} as const

const CADRES = {
  'carte': 'w-full aspect-[4/3]',
  'a-la-une': 'w-full aspect-[16/10]',
  'detail': 'w-full aspect-[16/10] lg:rounded-(--rayon-carte)',
  'miniature': 'size-16 shrink-0 rounded-2xl',
} as const

// Le titre est affiché dans la même carte ou ligne (carte, à la une, miniature) : l'image est décorative.
// Seul le détail porte un texte alternatif descriptif.
const alt = computed(() => (props.format === 'detail' ? `Image de la réalisation ${props.titre}` : ''))
</script>

<template>
  <div class="relative overflow-hidden bg-accent-doux" :class="CADRES[format]">
    <img
      v-if="image"
      :src="image.url"
      :srcset="image.srcset"
      :sizes="TAILLES[format]"
      :width="image.largeur"
      :height="image.hauteur"
      :alt="alt"
      :loading="format === 'detail' ? undefined : 'lazy'"
      :fetchpriority="format === 'detail' ? 'high' : undefined"
      class="size-full object-cover"
    >
    <div v-else aria-hidden="true" class="flex size-full items-center justify-center">
      <UIcon name="i-ph-image" :class="format === 'miniature' ? 'size-6' : 'size-10'" class="text-accent" />
    </div>
  </div>
</template>
