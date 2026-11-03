<script setup lang="ts">
import type { PrixPeriodeDTO } from '#shared/dto'
import { PERIODES_MOIS } from '#shared/plans'
import type { PeriodeMois } from '#shared/plans'

const props = defineProps<{
  prix: PrixPeriodeDTO[]
  devise: string
  /** Décimales de l'unité mineure de la devise (0 pour XAF). */
  exposant: number
  /** Légende du groupe : « Renouveler pour » ou « Choisir la durée ». */
  legende: string
  disabled?: boolean
  erreur?: string
}>()

const emit = defineEmits<{ choisir: [] }>()
const periode = defineModel<PeriodeMois>({ required: true })

const UI = { legend: 'mb-2 text-base font-semibold text-encre', item: 'w-full bg-champ', fieldset: 'gap-3' }

// Les valeurs d'un groupe radio sont des textes : conversion explicite vers la durée en mois.
const valeur = computed({
  get: () => String(periode.value),
  set: (texte: string) => {
    const mois = PERIODES_MOIS.find((p) => String(p) === texte)
    if (mois !== undefined) {
      periode.value = mois
      emit('choisir')
    }
  },
})

const items = computed(() => props.prix.map((p) => ({
  value: String(p.periodeMois),
  label: libellePeriode(p.periodeMois),
  description: detailPeriode(p, props.devise, props.exposant),
})))
</script>

<template>
  <div class="flex flex-col gap-2">
    <URadioGroup
      v-model="valeur"
      :legend="legende"
      :items="items"
      variant="card"
      size="lg"
      :disabled="disabled"
      :ui="UI"
    />
    <p v-if="erreur" role="alert" class="message-erreur">
      <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
      <span>{{ erreur }}</span>
    </p>
  </div>
</template>
