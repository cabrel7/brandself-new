<script setup lang="ts">
import type { TemoignageStudioDTO } from '#shared/dto'
import { metaTemoignageStudio } from '#shared/temoignages'

const props = defineProps<{
  temoignage: TemoignageStudioDTO
  /** Un changement de visibilité est en cours pour ce témoignage. */
  occupe: boolean
  /** Poignée de déplacement affichée (inutile avec un seul témoignage). */
  triable: boolean
}>()

const emit = defineEmits<{
  basculer: [actif: boolean]
  deplacer: [sens: -1 | 1]
}>()

const meta = computed(() => metaTemoignageStudio(props.temoignage))
const enVedette = computed(() => props.temoignage.actif && props.temoignage.enVedette)

function surTouche(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  emit('deplacer', event.key === 'ArrowUp' ? -1 : 1)
}
</script>

<template>
  <li class="flex items-center gap-1 border-b border-bordure bg-fond py-3">
    <NuxtLink
      :to="`/studio/temoignages/${temoignage.slug}`"
      class="flex min-w-0 flex-1 items-center gap-3 rounded-(--rayon-interne) text-encre no-underline transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        class="flex size-14 shrink-0 items-center justify-center rounded-(--rayon-interne) bg-accent-doux"
        :class="{ 'opacity-50 grayscale': !temoignage.actif }"
      >
        <UIcon name="i-ph-chat-centered-text" class="size-5 text-accent-texte" aria-hidden="true" />
      </span>
      <span class="flex min-w-0 flex-col items-start gap-1">
        <span
          class="line-clamp-2 text-base font-semibold wrap-break-word"
          :class="temoignage.actif ? 'text-encre' : 'text-texte-secondaire'"
        >{{ temoignage.auteur }}</span>
        <span v-if="meta" class="line-clamp-1 text-(length:--fs-14) text-texte-secondaire">{{ meta }}</span>
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
      :model-value="temoignage.actif"
      :disabled="occupe"
      :loading="occupe"
      :aria-label="`Visible sur la vitrine : ${temoignage.auteur}`"
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
      :data-poignee="temoignage.id"
      :aria-label="`Déplacer ${temoignage.auteur} (flèches haut et bas)`"
      @keydown="surTouche"
    />
  </li>
</template>
