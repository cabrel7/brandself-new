<script setup lang="ts">
import { PALETTES, PALETTE_LABELS } from '#shared/palettes'
import type { Palette } from '#shared/palettes'

const props = defineProps<{
  modelValue: Palette
  disabled?: boolean
  /** Id du titre qui nomme le groupe (sinon `aria-label`). */
  labelledby?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Palette]
}>()

const pastilles = useTemplateRef<HTMLButtonElement[]>('pastilles')

function choisir(palette: Palette): void {
  if (props.disabled || palette === props.modelValue) return
  emit('update:modelValue', palette)
}

// Comportement d'un groupe radio natif : les flèches déplacent le focus ET
// la sélection, Tab n'entre que sur la pastille choisie.
function surTouche(event: KeyboardEvent, index: number): void {
  const total = PALETTES.length
  let cible: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') cible = (index + 1) % total
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') cible = (index - 1 + total) % total
  else if (event.key === 'Home') cible = 0
  else if (event.key === 'End') cible = total - 1
  if (cible === null) return
  event.preventDefault()
  const palette = PALETTES[cible]
  if (!palette) return
  choisir(palette)
  pastilles.value?.[cible]?.focus()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      role="radiogroup"
      :aria-labelledby="labelledby"
      :aria-label="labelledby ? undefined : 'Palette de couleurs'"
      class="flex flex-wrap gap-3"
    >
      <button
        v-for="(palette, index) in PALETTES"
        :key="palette"
        ref="pastilles"
        type="button"
        role="radio"
        :data-palette="palette"
        :aria-checked="modelValue === palette"
        :aria-label="PALETTE_LABELS[palette]"
        :tabindex="modelValue === palette ? 0 : -1"
        :disabled="disabled"
        class="flex size-14 cursor-pointer items-center justify-center rounded-(--rayon) border border-bordure bg-fond transition-colors hover:border-texte-secondaire disabled:cursor-not-allowed disabled:opacity-55 aria-checked:border-2 aria-checked:border-accent"
        @click="choisir(palette)"
        @keydown="surTouche($event, index)"
      >
        <span class="size-6 rounded-full bg-accent" aria-hidden="true" />
      </button>
    </div>
    <p class="m-0 text-(length:--fs-14) text-texte-secondaire" aria-live="polite">
      Palette choisie : {{ PALETTE_LABELS[modelValue] }}
    </p>
  </div>
</template>
