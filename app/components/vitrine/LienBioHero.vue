<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'

// Au-delà de cette longueur, un mot du nom ne tient plus sur une ligne en grande taille (342 px utiles à 390 px).
const MOT_LONG = 11

const props = defineProps<{ vitrine: VitrinePubliqueDTO }>()

const metierVille = computed(() =>
  [props.vitrine.metier, props.vitrine.ville].filter(Boolean).join(' · '),
)

// Titre uniforme : seule la taille change, selon le plus long mot du nom (jamais coupé au milieu).
const nomLong = computed(() =>
  props.vitrine.nomAffiche.split(/\s+/).some(mot => mot.length > MOT_LONG),
)
</script>

<template>
  <section>
    <!-- Le portrait est l’élément le plus lourd et le LCP : dimensions déclarées, jamais différé. -->
    <div v-if="vitrine.photo" class="fondu-bas md:fondu-cotes relative aspect-square w-full overflow-hidden bg-accent-doux md:aspect-4/5">
      <img
        :src="vitrine.photo.url"
        :srcset="vitrine.photo.srcset"
        sizes="(min-width: 768px) 460px, (min-width: 448px) 448px, 100vw"
        :width="vitrine.photo.largeur"
        :height="vitrine.photo.hauteur"
        :alt="`Portrait de ${vitrine.nomAffiche}`"
        fetchpriority="high"
        decoding="async"
        class="size-full object-cover object-top"
      >
    </div>
    <!-- Sans portrait : rien à montrer, juste la place de l’en-tête (logo et « Partager »). -->
    <div v-else class="h-20 md:hidden" aria-hidden="true" />

    <!-- Avec portrait, le nom commence là où le fondu s’éteint : jamais sur le visage (même mise en page sur tous les écrans). -->
    <div class="relative z-10 flex flex-col items-start gap-3 px-6 md:px-0" :class="{ '-mt-16': vitrine.photo }">
      <h1
        class="m-0 font-(family-name:--font-titre) leading-[1.05] font-bold text-encre"
        :class="nomLong ? 'text-(length:--fs-32)' : 'text-(length:--fs-48)'"
      >
        {{ vitrine.nomAffiche }}
      </h1>
      <p
        v-if="metierVille"
        class="m-0 inline-flex min-h-9 items-center gap-2 rounded-full bg-accent-doux px-4 py-1 text-(length:--fs-16) font-medium text-encre"
      >
        <UIcon name="i-ph-map-pin" class="size-5 shrink-0 text-accent-texte" aria-hidden="true" />
        <span>{{ metierVille }}</span>
      </p>
      <template v-if="vitrine.accroche">
        <p class="m-0 text-(length:--fs-20) leading-snug text-texte-secondaire">{{ vitrine.accroche }}</p>
        <span class="h-0.5 w-12 bg-accent" aria-hidden="true" />
      </template>
    </div>
  </section>
</template>
