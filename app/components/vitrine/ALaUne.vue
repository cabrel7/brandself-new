<script setup lang="ts">
import type { RealisationPublicCarteDTO } from '#shared/dto'
import { realisationDetailHref, realisationsHref } from '#shared/realisations'

defineProps<{ username: string, realisation: RealisationPublicCarteDTO, realisationsTotal: number }>()

// Seule (avant le témoignage, S5), la carte passe en disposition horizontale dès `md`
// pour ne pas laisser une colonne vide.
const slots = useSlots()
const seule = computed(() => !slots.temoignage)
</script>

<template>
  <section aria-labelledby="a-la-une" class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
    <div class="flex flex-col gap-2">
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">Réalisations</p>
      <h2 id="a-la-une" class="font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold">À la une</h2>
    </div>

    <div class="grid gap-6 md:grid-cols-2">
      <article class="flex flex-col gap-4" :class="seule ? 'md:col-span-2 md:flex-row md:items-center md:gap-8' : ''">
        <div class="overflow-hidden rounded-(--rayon-carte)" :class="seule ? 'md:w-1/2 md:shrink-0' : ''">
          <RealisationVisuel :image="realisation.image" :titre="realisation.titre" format="carte" class="aspect-[16/10]!" />
        </div>
        <div class="flex flex-col gap-3">
          <h3 class="font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold">
            <NuxtLink :to="realisationDetailHref(username, realisation.slug)" class="hover:underline">
              {{ realisation.titre }}
            </NuxtLink>
          </h3>
          <p v-if="realisation.description" class="line-clamp-3 max-w-prose text-texte-secondaire">
            {{ realisation.description }}
          </p>
          <NuxtLink
            :to="realisationsHref(username)"
            class="inline-flex min-h-(--cible-tactile) items-center gap-1 self-start font-semibold text-accent-texte hover:underline"
          >
            Voir toutes les réalisations ({{ realisationsTotal }})
            <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
          </NuxtLink>
        </div>
      </article>
      <slot name="temoignage" />
    </div>
  </section>
</template>
