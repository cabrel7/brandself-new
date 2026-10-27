<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'

const props = defineProps<{ images: MediaDTO[], titre: string }>()

const total = computed(() => props.images.length)
</script>

<template>
  <section v-if="total > 0" aria-label="Galerie">
    <ul class="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <li v-for="(image, index) in images" :key="image.id">
        <a
          :href="image.url"
          :aria-label="`Agrandir l'image ${index + 1} sur ${total}`"
          class="block aspect-square overflow-hidden rounded-2xl bg-accent-doux focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <img
            :src="image.url"
            :srcset="image.srcset"
            sizes="(min-width: 1024px) 20vw, 45vw"
            :width="image.largeur"
            :height="image.hauteur"
            :alt="`Image ${index + 1} sur ${total} : ${titre}`"
            loading="lazy"
            class="size-full object-cover transition-transform hover:scale-[1.02] motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
        </a>
      </li>
    </ul>
  </section>
</template>
