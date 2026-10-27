<script setup lang="ts">
import type { RealisationPublicCarteDTO } from '#shared/dto'
import { metaRealisation, realisationDetailHref, realisationsHref } from '#shared/realisations'

defineProps<{ autres: RealisationPublicCarteDTO[], total: number, username: string }>()
</script>

<template>
  <section v-if="autres.length > 0" aria-labelledby="realisation-autres" class="flex flex-col gap-4">
    <h2 id="realisation-autres" class="font-(family-name:--font-titre) text-(length:--fs-24) font-bold">Autres réalisations</h2>
    <ul class="flex flex-col border-t border-bordure">
      <li v-for="autre in autres" :key="autre.slug" class="border-b border-bordure">
        <NuxtLink
          :to="realisationDetailHref(username, autre.slug)"
          class="flex min-h-(--cible-tactile) items-center gap-4 py-4 transition-colors hover:text-accent"
        >
          <RealisationVisuel :image="autre.image" :titre="autre.titre" format="miniature" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="font-(family-name:--font-titre) text-(length:--fs-20) leading-snug font-bold">{{ autre.titre }}</span>
            <span v-if="metaRealisation(autre)" class="text-(length:--fs-14) text-texte-secondaire">{{ metaRealisation(autre) }}</span>
          </span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0 text-accent" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
    <NuxtLink
      :to="realisationsHref(username)"
      class="inline-flex min-h-(--cible-tactile) items-center gap-1 self-start font-semibold text-accent-texte hover:underline"
    >
      Voir toutes les réalisations ({{ total }})
      <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
    </NuxtLink>
  </section>
</template>
