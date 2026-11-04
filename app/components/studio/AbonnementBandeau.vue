<script setup lang="ts">
import { ABONNEMENT_CHEMIN } from '#shared/plans'

const props = defineProps<{
  /** Instant ISO de la fin de la période de grâce (exclusif). */
  graceJusquau: string
}>()

const idTitre = useId()
// Les dates s'affichent dans le fuseau du compte, comme la carte Abonnement.
const { moi } = useMoi()
const jourFin = computed(() => (moi.value ? dernierJourAvant(props.graceJusquau, moi.value.fuseau) : ''))
</script>

<template>
  <section :aria-labelledby="idTitre" class="flex flex-col items-start gap-3 rounded-(--rayon-carte) bg-accent-doux p-6 text-start">
    <h2 :id="idTitre" class="m-0 text-(length:--fs-20) leading-snug font-bold text-encre">
      Votre abonnement est terminé.
    </h2>
    <p class="m-0 text-base text-encre">
      <template v-if="jourFin">
        Vous gardez tout jusqu’au {{ jourFin }}.
      </template>
      Ensuite, votre vitrine repasse au plan gratuit. Rien n’est supprimé.
    </p>
    <UButton
      label="Renouveler mon abonnement"
      :to="ABONNEMENT_CHEMIN"
      block
      size="lg"
      class="min-h-(--cible-tactile) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-encre"
    />
  </section>
</template>
