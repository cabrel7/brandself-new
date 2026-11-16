<script setup lang="ts">
import type { ImpactPlan, ValeursPlan } from '#shared/schemas/admin-versions'
import { impactNonNul, lignesImpact, phraseImpact } from '~/utils/admin-versions'

// Aperçu de ce que change un plan, avant activation (lecture seule). Le calcul vient du serveur ; ce bloc l'affiche,
// signale les contenus qui seront masqués (jamais supprimés) et recueille l'acquittement explicite de CET impact.
// L'impact peut être remplacé de l'extérieur (le serveur en recalcule un autre à l'activation) : l'acquittement retombe.
const props = defineProps<{ cle: string, valeurs: ValeursPlan, desactive?: boolean }>()
const impact = defineModel<ImpactPlan | null>('impact', { required: true })
const acquitte = defineModel<boolean>('acquitte', { required: true })

const { apercuImpact } = useAdminVersionsEcritures()
const enCours = ref(true)
const erreur = ref('')
const mention = ref('')

const lignes = computed(() => (impact.value ? lignesImpact(impact.value) : []))
const concerne = computed(() => (impact.value ? impactNonNul(impact.value) : false))

async function charger(): Promise<void> {
  enCours.value = true
  erreur.value = ''
  acquitte.value = false
  const resultat = await apercuImpact(props.cle, props.valeurs)
  enCours.value = false
  if (!resultat.ok) {
    impact.value = null
    erreur.value = resultat.message
    return
  }
  impact.value = resultat.donnees.impact
  mention.value = resultat.donnees.mention
}

// Un impact recalculé par le serveur remplace l'aperçu : il faut le relire et le confirmer à nouveau.
watch(impact, () => {
  acquitte.value = false
})

onMounted(charger)
</script>

<template>
  <section aria-labelledby="titre-impact" class="flex flex-col gap-3" :aria-busy="enCours">
    <h3 id="titre-impact" class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold">Ce que ce plan change</h3>

    <div v-if="enCours" class="flex flex-col gap-2" role="status">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-10 w-full" />
      <span class="sr-only">Calcul de l’impact en cours</span>
    </div>

    <div v-else-if="erreur" class="flex flex-col items-start gap-3">
      <UAlert role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" class="w-full" />
      <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" class="min-h-(--cible-tactile)" @click="charger">
        Recalculer
      </UButton>
    </div>

    <template v-else-if="impact">
      <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
        <li v-for="ligne in lignes" :key="ligne.cle" class="flex items-baseline justify-between gap-4 px-1 py-3">
          <span class="text-encre">{{ ligne.libelle }}</span>
          <span class="text-right font-medium text-encre">{{ phraseImpact(ligne) }}</span>
        </li>
      </ul>
      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">{{ mention }}</p>
      <p v-if="concerne" class="m-0 text-base text-texte-secondaire">
        Les éléments en trop sont masqués sur les vitrines, jamais supprimés. Le retour arrière les rétablit.
      </p>
      <p v-else class="m-0 text-base text-texte-secondaire">Aucun compte n’est touché par ce plan.</p>
      <USwitch
        v-if="concerne"
        v-model="acquitte"
        label="J’ai pris connaissance de cet impact"
        description="Il sera comparé au calcul au moment de l’activation."
        :disabled="desactive"
        :ui="{ root: 'min-h-(--cible-tactile) items-center' }"
      />
    </template>
  </section>
</template>
