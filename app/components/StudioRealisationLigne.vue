<script setup lang="ts">
import type { RealisationStudioDTO } from '#shared/dto'
import { metaRealisationStudio } from '#shared/realisations'

const props = defineProps<{
  realisation: RealisationStudioDTO
  /** Un changement de visibilité est en cours pour cette réalisation. */
  occupe: boolean
  /** Poignée de déplacement affichée (inutile avec une seule réalisation). */
  triable: boolean
}>()

const emit = defineEmits<{
  basculer: [actif: boolean]
  deplacer: [sens: -1 | 1]
}>()

const meta = computed(() => metaRealisationStudio(props.realisation))
const enVedette = computed(() => props.realisation.actif && props.realisation.enVedette)

function surTouche(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  emit('deplacer', event.key === 'ArrowUp' ? -1 : 1)
}
</script>

<template>
  <li class="flex items-center gap-1 border-b border-bordure bg-fond py-3 transition-colors hover:bg-surface">
    <NuxtLink
      :to="`/studio/realisations/${realisation.id}`"
      class="flex min-w-0 flex-1 items-center gap-3 rounded-(--rayon-interne) text-encre no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-(--rayon-interne)"
        :class="[
          realisation.image ? 'bg-accent-doux' : 'border border-dashed border-bordure',
          { 'opacity-50 grayscale': !realisation.actif },
        ]"
      >
        <img
          v-if="realisation.image"
          :src="realisation.image.url"
          :srcset="realisation.image.srcset"
          sizes="56px"
          :width="realisation.image.largeur"
          :height="realisation.image.hauteur"
          alt=""
          class="size-full object-cover"
        >
      </span>
      <span class="flex min-w-0 flex-col items-start gap-1">
        <span
          class="line-clamp-2 text-base font-semibold wrap-break-word"
          :class="realisation.actif ? 'text-encre' : 'text-texte-secondaire'"
        >{{ realisation.titre }}</span>
        <span v-if="meta" class="text-(length:--fs-14) text-texte-secondaire">{{ meta }}</span>
        <UBadge
          v-if="enVedette"
          label="En vedette"
          color="primary"
          variant="soft"
          class="bg-accent-doux text-(length:--fs-14) font-semibold text-accent-texte"
        />
      </span>
    </NuxtLink>

    <USwitch
      :model-value="realisation.actif"
      :disabled="occupe"
      :loading="occupe"
      :aria-label="`Visible sur la vitrine : ${realisation.titre}`"
      class="min-w-(--cible-tactile) shrink-0 justify-center"
      @update:model-value="emit('basculer', $event)"
    />

    <UButton
      v-if="triable"
      icon="i-ph-dots-six-vertical"
      variant="ghost"
      color="neutral"
      size="lg"
      class="size-(--cible-tactile) shrink-0 cursor-grab touch-none justify-center px-0 active:cursor-grabbing"
      :data-poignee="realisation.id"
      :aria-label="`Déplacer ${realisation.titre} (flèches haut et bas)`"
      @keydown="surTouche"
    />
  </li>
</template>
