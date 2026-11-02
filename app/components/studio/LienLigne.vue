<script setup lang="ts">
import { computed } from 'vue'
import type { LienStudioDTO } from '#shared/dto'
import { ICON_LIEN, iconeReseau, libelleReseau } from '#shared/liens'

const props = defineProps<{
  lien: LienStudioDTO
  /** Un changement de visibilité est en cours pour ce lien. */
  occupe: boolean
  /** Poignée de déplacement affichée (inutile avec un seul lien). */
  triable: boolean
}>()

const emit = defineEmits<{
  basculer: [actif: boolean]
  deplacer: [sens: -1 | 1]
}>()

function surTouche(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  emit('deplacer', event.key === 'ArrowUp' ? -1 : 1)
}

const libelleType = computed(() => {
  if (props.lien.type === 'reseau') return libelleReseau(props.lien.plateforme ?? '')
  const libelles: Record<Exclude<LienStudioDTO['type'], 'reseau'>, string> = {
    libre: 'Lien libre',
    whatsapp: 'WhatsApp',
    email: 'Courriel',
    telephone: 'Téléphone',
    vitrine: 'Page de votre vitrine',
  }
  return libelles[props.lien.type]
})

const icone = computed(() =>
  props.lien.type === 'reseau' ? iconeReseau(props.lien.plateforme ?? null) : ICON_LIEN,
)

const texteClics = computed(() => {
  const clics = props.lien.clicsSemaine
  return `${clics} clic${clics > 1 ? 's' : ''}`
})
</script>

<template>
  <li class="flex items-center gap-1 border-b border-bordure bg-fond py-2 transition-colors hover:bg-surface">
    <UButton
      v-if="triable"
      icon="i-ph-dots-six-vertical"
      variant="ghost"
      color="neutral"
      size="lg"
      class="size-(--cible-tactile) shrink-0 cursor-grab touch-none justify-center px-0 active:cursor-grabbing"
      :data-poignee="lien.id"
      :aria-label="`Déplacer ${lien.libelle} (flèches haut et bas)`"
      @keydown="surTouche"
    />

    <NuxtLink
      :to="`/studio/liens/${lien.id}`"
      class="flex min-h-(--cible-tactile) min-w-0 flex-1 items-center gap-3 rounded-(--rayon-interne) text-encre no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-(--rayon-interne) bg-accent-doux"
        :class="{ 'opacity-50': !lien.actif }"
      >
        <UIcon :name="icone" class="size-5 text-accent-texte" aria-hidden="true" />
      </span>
      <span class="flex min-w-0 flex-col items-start gap-1">
        <span class="text-base font-semibold wrap-break-word" :class="lien.actif ? 'text-encre' : 'text-texte-secondaire'">{{ lien.libelle }}</span>
        <span class="text-(length:--fs-14) text-texte-secondaire">{{ libelleType }} · {{ texteClics }}</span>
      </span>
    </NuxtLink>

    <USwitch
      :model-value="lien.actif"
      :disabled="occupe"
      :loading="occupe"
      :aria-label="`Visible sur votre page de liens : ${lien.libelle}`"
      class="min-h-(--cible-tactile) min-w-(--cible-tactile) shrink-0 justify-center"
      @update:model-value="emit('basculer', $event)"
    />
  </li>
</template>
