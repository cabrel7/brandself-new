<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'

defineProps<{ image: MediaDTO | null, titre: string, format: 'carte' | 'detail' | 'miniature' }>()

const TAILLES = {
  carte: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  detail: '(min-width: 1024px) 50vw, 100vw',
  miniature: '64px',
} as const

const CADRES = {
  carte: 'aspect-[4/3]',
  detail: 'aspect-[16/10] lg:rounded-(--rayon-carte)',
  miniature: 'size-16 shrink-0 rounded-2xl',
} as const
</script>

<template>
  <div class="relative w-full overflow-hidden bg-accent-doux" :class="CADRES[format]">
    <img
      v-if="image"
      :src="image.url"
      :srcset="image.srcset"
      :sizes="TAILLES[format]"
      :width="image.largeur"
      :height="image.hauteur"
      :alt="`Image de la réalisation ${titre}`"
      :loading="format === 'detail' ? undefined : 'lazy'"
      :fetchpriority="format === 'detail' ? 'high' : undefined"
      class="size-full object-cover"
    >
    <div v-else aria-hidden="true" class="flex size-full items-center justify-center">
      <UIcon name="i-ph-image" :class="format === 'miniature' ? 'size-6' : 'size-10'" class="text-accent" />
    </div>
  </div>
</template>
