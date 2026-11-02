<script setup lang="ts">
import { ONBOARDING_ETAPES, ONBOARDING_ETAPES_TOTAL } from '#shared/onboarding'
import type { OnboardingEtape } from '#shared/onboarding'

const props = defineProps<{ etape: OnboardingEtape }>()

const emit = defineEmits<{ retour: [] }>()

const segments = Array.from({ length: ONBOARDING_ETAPES_TOTAL }, (_, i) => i + 1)
const texteEtape = computed(() => `Étape ${props.etape} sur ${ONBOARDING_ETAPES_TOTAL}`)
const valeurTexte = computed(() => `${texteEtape.value} : ${ONBOARDING_ETAPES[props.etape]}`)
</script>

<template>
  <header class="flex flex-col gap-3">
    <div class="flex min-h-(--cible-tactile) items-center justify-between gap-4">
      <button
        v-if="etape > 1"
        type="button"
        class="-ms-2 flex min-h-(--cible-tactile) cursor-pointer items-center gap-2 rounded-(--rayon-interne) px-2 font-semibold text-encre transition-colors hover:bg-surface"
        @click="emit('retour')"
      >
        <UIcon name="i-ph-arrow-left" class="size-5" aria-hidden="true" />
        Retour
      </button>
      <span v-else aria-hidden="true" />
      <span class="text-(length:--fs-14) text-texte-secondaire">{{ texteEtape }}</span>
    </div>

    <div
      role="progressbar"
      aria-label="Progression de votre inscription"
      :aria-valuemin="1"
      :aria-valuemax="ONBOARDING_ETAPES_TOTAL"
      :aria-valuenow="etape"
      :aria-valuetext="valeurTexte"
      class="flex gap-2"
    >
      <span
        v-for="segment in segments"
        :key="segment"
        aria-hidden="true"
        class="h-1 flex-1 rounded-full transition-colors"
        :class="segment <= etape ? 'bg-accent' : 'bg-bordure'"
      />
    </div>
  </header>
</template>
