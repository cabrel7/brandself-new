<script setup lang="ts">
import type { ProchaineEtape } from '~/utils/prochaine-etape'

defineProps<{ etape: ProchaineEtape }>()

const idTitre = useId()
</script>

<template>
  <section :aria-labelledby="idTitre" class="flex flex-col items-start gap-3 rounded-(--rayon-carte) bg-accent-doux p-6 text-start">
    <p class="m-0 text-(length:--fs-14) font-bold tracking-widest text-accent-texte uppercase">
      Prochaine étape
    </p>
    <h2 :id="idTitre" class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) leading-snug font-bold text-encre">
      {{ etape.titre }}
    </h2>
    <p class="m-0 text-base text-encre">
      {{ etape.texte }}
    </p>
    <UButton
      :label="etape.action"
      :to="etape.to"
      block
      class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-encre"
      :aria-describedby="idTitre"
    />
  </section>
</template>
