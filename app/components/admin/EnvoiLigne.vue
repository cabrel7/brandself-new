<script setup lang="ts">
import type { EnvoisDto } from '#shared/schemas/admin-a4'
import { formaterNombre } from '~/utils/admin-paiements'
import { ICONES_CANAL, LIBELLES_CANAL, formaterTauxSupervision, nomPaysSupervision } from '~/utils/admin-supervision'

// Une ligne d'envois de codes (canal et pays) : envoyés, échecs et taux d'échec. Aucun numéro ni code : des totaux.
const props = defineProps<{ ligne: EnvoisDto['lignes'][number] }>()

const total = computed(() => props.ligne.envoyes + props.ligne.echecs)
const destination = computed(() => (props.ligne.pays === null ? LIBELLES_CANAL[props.ligne.canal] : `${LIBELLES_CANAL[props.ligne.canal]} · ${nomPaysSupervision(props.ligne.pays)}`))
</script>

<template>
  <div class="flex min-h-(--cible-tactile) flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
    <span class="flex min-w-0 items-center gap-2 font-medium text-encre">
      <UIcon :name="ICONES_CANAL[ligne.canal]" class="size-5 shrink-0 text-texte-secondaire" aria-hidden="true" />
      {{ destination }}
    </span>
    <span class="text-base text-texte-secondaire">
      {{ formaterNombre(ligne.envoyes) }} envoyés · {{ formaterNombre(ligne.echecs) }} en échec
      ({{ formaterTauxSupervision(ligne.echecs, total) }})
    </span>
  </div>
</template>
