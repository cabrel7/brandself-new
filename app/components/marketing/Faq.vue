<script setup lang="ts">
import { FAQ } from '~/data/landing'

// Questions en `details` / `summary` natifs : fonctionnent sans JavaScript, au clavier et au lecteur d'écran.
const TEXTES = {
  surtitre: 'Questions',
  titre: 'Les questions qu’on nous pose.',
} as const
</script>

<template>
  <section id="faq" class="px-4 py-20 md:px-6 md:py-30" aria-labelledby="titre-faq">
    <div class="mx-auto w-full max-w-290">
      <div class="mx-auto mb-12 flex max-w-200 flex-col items-center gap-3 text-center md:mb-16">
        <p class="m-0 text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">
          {{ TEXTES.surtitre }}
        </p>
        <h2 id="titre-faq" class="m-0 text-balance font-(family-name:--font-titre) text-[clamp(2.125rem,4.8vw,3.625rem)] leading-[1.06] font-medium text-encre">
          {{ TEXTES.titre }}
        </h2>
      </div>

      <div class="mx-auto max-w-190 border-t border-bordure">
        <details v-for="(item, index) in FAQ" :key="item.question" class="group border-b border-bordure" :open="index === 0">
          <summary class="flex min-h-(--cible-tactile) cursor-pointer list-none items-center justify-between gap-5 py-5 font-(family-name:--font-titre) text-[clamp(1.3125rem,2.6vw,1.625rem)] leading-tight text-encre md:py-6 [&::-webkit-details-marker]:hidden">
            <span>{{ item.question }}</span>
            <UIcon name="i-ph-caret-down" class="size-5 shrink-0 text-accent-texte transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <p class="m-0 pb-6 text-lg text-texte-secondaire md:pr-10">
            {{ item.reponse }}
          </p>
        </details>
      </div>
    </div>
  </section>
</template>
