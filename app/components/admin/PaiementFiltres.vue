<script setup lang="ts">
import { PAIEMENT_SOURCES } from '#shared/admin-paiements'
import { DEVISES } from '#shared/compte'
import { PAIEMENT_STATUTS } from '#shared/paiements'
import type { FiltresPaiements } from '#shared/schemas/admin-paiements'
import { UI_CHAMP_TACTILE } from '~/utils/admin-ui'
import { FILTRE_TOUS, LIBELLES_SOURCE, LIBELLES_STATUT, modifierFiltre, periodeInvalide } from '~/utils/admin-paiements'

const MESSAGE_PERIODE = 'La date de début doit précéder la date de fin.'

const props = defineProps<{ modelValue: FiltresPaiements, desactive: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [filtres: FiltresPaiements] }>()

const optionsStatut = [
  { label: 'Tous', value: FILTRE_TOUS },
  ...PAIEMENT_STATUTS.map((statut) => ({ label: LIBELLES_STATUT[statut], value: statut })),
]
const optionsSource = [
  { label: 'Toutes', value: FILTRE_TOUS },
  ...PAIEMENT_SOURCES.map((source) => ({ label: LIBELLES_SOURCE[source], value: source })),
]
const optionsDevise = [
  { label: 'Toutes', value: FILTRE_TOUS },
  ...DEVISES.map((devise) => ({ label: devise, value: devise })),
]

// Les dates sont validées avant d'être appliquées : une période inversée n'envoie aucune requête.
const du = ref(props.modelValue.du ?? '')
const au = ref(props.modelValue.au ?? '')
watch(() => props.modelValue, (filtres) => {
  du.value = filtres.du ?? ''
  au.value = filtres.au ?? ''
})

const erreurPeriode = computed(() =>
  periodeInvalide({ du: du.value || undefined, au: au.value || undefined }) ? MESSAGE_PERIODE : '',
)

type CleFiltre = 'statut' | 'source' | 'devise'

function changerListe(cle: CleFiltre, valeur: string): void {
  emit('update:modelValue', modifierFiltre(props.modelValue, cle, valeur === FILTRE_TOUS ? '' : valeur))
}

function changerDate(cle: 'du' | 'au', valeur: string): void {
  if (cle === 'du') du.value = valeur
  else au.value = valeur
  if (erreurPeriode.value) return
  emit('update:modelValue', modifierFiltre(props.modelValue, cle, valeur))
}

const actifs = computed(() => Object.keys(props.modelValue).length > 0)
</script>

<template>
  <form class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtres des paiements" @submit.prevent>
    <UFormField label="Statut" name="statut">
      <USelect
        :model-value="modelValue.statut ?? FILTRE_TOUS"
        :items="optionsStatut"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        class="w-full"
        @update:model-value="changerListe('statut', String($event))"
      />
    </UFormField>
    <UFormField label="Source" name="source">
      <USelect
        :model-value="modelValue.source ?? FILTRE_TOUS"
        :items="optionsSource"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        class="w-full"
        @update:model-value="changerListe('source', String($event))"
      />
    </UFormField>
    <UFormField label="Devise" name="devise">
      <USelect
        :model-value="modelValue.devise ?? FILTRE_TOUS"
        :items="optionsDevise"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        class="w-full"
        @update:model-value="changerListe('devise', String($event))"
      />
    </UFormField>
    <UFormField label="Du" name="du" :error="erreurPeriode">
      <UInput
        :model-value="du"
        type="date"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        :max="au || undefined"
        class="w-full"
        @update:model-value="changerDate('du', String($event))"
      />
    </UFormField>
    <UFormField label="Au" name="au">
      <UInput
        :model-value="au"
        type="date"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        :min="du || undefined"
        class="w-full"
        @update:model-value="changerDate('au', String($event))"
      />
    </UFormField>
    <div v-if="actifs" class="sm:col-span-2 lg:col-span-5">
      <UButton
        color="neutral"
        variant="link"
        size="lg"
        icon="i-ph-x"
        class="-ml-3 min-h-(--cible-tactile) font-medium"
        :disabled="desactive"
        @click="emit('update:modelValue', {})"
      >
        Réinitialiser les filtres
      </UButton>
    </div>
  </form>
</template>
