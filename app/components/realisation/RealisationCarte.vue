<script setup lang="ts">
import type { RealisationPublicCarteDTO } from '#shared/dto'
import { metaRealisation, realisationDetailHref } from '#shared/realisations'

const props = defineProps<{ realisation: RealisationPublicCarteDTO, username: string }>()

const meta = computed(() => metaRealisation(props.realisation))
</script>

<template>
  <article class="relative flex h-full flex-col overflow-hidden rounded-(--rayon-carte) border border-bordure bg-surface transition-[border-color,box-shadow] hover:border-texte-secondaire hover:shadow-sm has-[h2_a:focus-visible]:outline-2 has-[h2_a:focus-visible]:outline-offset-2 has-[h2_a:focus-visible]:outline-accent">
    <RealisationVisuel :image="realisation.image" :titre="realisation.titre" format="carte" />
    <div class="flex flex-1 flex-col gap-3 p-6">
      <p v-if="meta" class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">{{ meta }}</p>
      <h2 class="font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold">
        <NuxtLink
          :to="realisationDetailHref(username, realisation.slug)"
          class="focus-visible:outline-none! after:absolute after:inset-0 after:content-['']"
        >
          {{ realisation.titre }}
        </NuxtLink>
      </h2>
      <p v-if="realisation.description" class="line-clamp-2 text-texte-secondaire">{{ realisation.description }}</p>
    </div>
  </article>
</template>
