<script setup lang="ts">
type Variant = 'principal' | 'contour' | 'neutre' | 'lien'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    disabled?: boolean
    loading?: boolean
    to?: string
    type?: 'button' | 'submit' | 'reset'
    block?: boolean
  }>(),
  { variant: 'principal', type: 'button', to: undefined },
)

const NuxtLink = resolveComponent('NuxtLink')

// Réactif : `props` n'est jamais destructuré.
const inactif = computed(() => props.disabled || props.loading)

const classes = computed(() => [
  'bs-bouton',
  `bs-bouton--${props.variant}`,
  { 'bs-bouton--bloc': props.block, 'bs-bouton--chargement': props.loading },
])
</script>

<template>
  <component
    :is="NuxtLink"
    v-if="to"
    :to="to"
    :class="[classes, { 'bs-bouton--inactif': inactif }]"
    :aria-disabled="inactif || undefined"
    :tabindex="inactif ? -1 : undefined"
    :aria-busy="loading || undefined"
  >
    <span v-if="loading" class="bs-bouton__spinner" aria-hidden="true" />
    <slot />
  </component>
  <button
    v-else
    :type="type"
    :class="classes"
    :disabled="inactif"
    :aria-busy="loading || undefined"
  >
    <span v-if="loading" class="bs-bouton__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.bs-bouton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: var(--hauteur-controle);
  padding: 0 1.5rem;
  border: 1px solid transparent;
  border-radius: var(--rayon);
  font-family: var(--font-texte);
  font-size: var(--fs-16);
  font-weight: 600;
  line-height: 1.25;
  text-decoration: none;
  cursor: pointer;
  transition:
    background-color var(--transition),
    border-color var(--transition),
    color var(--transition);
}

.bs-bouton--bloc {
  display: flex;
  width: 100%;
}

.bs-bouton--principal {
  background-color: var(--accent);
  border-color: var(--accent);
  color: var(--sur-accent);
}

.bs-bouton--principal:hover:not(:disabled, .bs-bouton--inactif) {
  background-color: color-mix(in srgb, var(--accent) 88%, var(--encre));
  border-color: color-mix(in srgb, var(--accent) 88%, var(--encre));
}

.bs-bouton--contour {
  background-color: transparent;
  border-color: var(--bordure);
  color: var(--encre);
}

.bs-bouton--contour:hover:not(:disabled, .bs-bouton--inactif) {
  background-color: var(--accent-doux);
}

.bs-bouton--neutre {
  background-color: var(--champ);
  border-color: var(--bordure);
  color: var(--encre);
  font-weight: 500;
}

.bs-bouton--neutre:hover:not(:disabled, .bs-bouton--inactif) {
  background-color: var(--surface);
}

.bs-bouton--lien {
  min-height: var(--cible-tactile);
  padding: 0 0.5rem;
  background-color: transparent;
  color: var(--accent);
  font-weight: 500;
  text-underline-offset: 4px;
}

.bs-bouton--lien:hover:not(:disabled, .bs-bouton--inactif) {
  text-decoration: underline;
}

.bs-bouton:active:not(:disabled, .bs-bouton--inactif) {
  filter: brightness(0.95);
}

.bs-bouton:disabled,
.bs-bouton--inactif {
  opacity: 0.55;
  cursor: not-allowed;
}

.bs-bouton--chargement {
  cursor: progress;
}

.bs-bouton__spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: bs-rotation 700ms linear infinite;
}

@keyframes bs-rotation {
  to {
    transform: rotate(360deg);
  }
}
</style>
