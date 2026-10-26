<script setup lang="ts">
import type { ServiceStudioDTO } from '#shared/dto'
import { metaStudio } from '#shared/services'

const props = defineProps<{
  service: ServiceStudioDTO
  /** Un changement de visibilité est en cours pour ce service. */
  occupe: boolean
  /** Poignée de déplacement affichée (inutile avec un seul service). */
  triable: boolean
}>()

const emit = defineEmits<{
  basculer: [actif: boolean]
  deplacer: [sens: -1 | 1]
}>()

const meta = computed(() => metaStudio(props.service))
const enVedette = computed(() => props.service.actif && props.service.enVedette)

function surTouche(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  emit('deplacer', event.key === 'ArrowUp' ? -1 : 1)
}
</script>

<template>
  <li class="flex items-center gap-1 border-b border-bordure bg-fond py-3 transition-colors hover:bg-surface">
    <NuxtLink
      :to="`/studio/services/${service.id}`"
      class="flex min-w-0 flex-1 items-center gap-3 rounded-(--rayon-interne) text-encre no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-(--rayon-interne)"
        :class="[
          service.image ? 'bg-accent-doux' : 'border border-dashed border-bordure',
          { 'opacity-50 grayscale': !service.actif },
        ]"
      >
        <img
          v-if="service.image"
          :src="service.image.url"
          :srcset="service.image.srcset"
          sizes="56px"
          :width="service.image.largeur"
          :height="service.image.hauteur"
          alt=""
          class="size-full object-cover"
        >
      </span>
      <span class="flex min-w-0 flex-col items-start gap-1">
        <span
          class="text-base font-semibold wrap-break-word"
          :class="service.actif ? 'text-encre' : 'text-texte-secondaire'"
        >{{ service.titre }}</span>
        <span class="text-(length:--fs-14) text-texte-secondaire">{{ meta }}</span>
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
      :model-value="service.actif"
      :disabled="occupe"
      :loading="occupe"
      :aria-label="`Visible sur la vitrine : ${service.titre}`"
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
      :data-poignee="service.id"
      :aria-label="`Déplacer ${service.titre} (flèches haut et bas)`"
      @keydown="surTouche"
    />
  </li>
</template>
