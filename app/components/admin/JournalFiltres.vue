<script setup lang="ts">
import { UI_CHAMP_TACTILE } from '~/utils/admin-ui'
import {
  FILTRE_JOURNAL_TOUS,
  optionsActionsJournal,
  optionsCiblesJournal,
  periodeJournalInvalide,
} from '~/utils/admin-journal'

const MESSAGE_PERIODE = 'La date de début doit précéder la date de fin.'
const DELAI_IDENTIFIANT_MS = 400

// Filtres du journal. Chaque changement émet un correctif (`nom`, `valeur` vide = retirer) : l'URL reste la seule
// source de vérité. Une période inversée n'envoie aucune requête.
const props = defineProps<{ filtres: Record<string, string>, desactive: boolean }>()
const emit = defineEmits<{ modifier: [correctif: Record<string, string | undefined>], reinitialiser: [] }>()

const optionsActions = optionsActionsJournal()
const optionsCibles = optionsCiblesJournal()

const du = ref(props.filtres.du ?? '')
const au = ref(props.filtres.au ?? '')
const cibleId = ref(props.filtres.cibleId ?? '')
watch(() => props.filtres, (filtres) => {
  du.value = filtres.du ?? ''
  au.value = filtres.au ?? ''
  cibleId.value = filtres.cibleId ?? ''
})

const erreurPeriode = computed(() => (periodeJournalInvalide(du.value, au.value) ? MESSAGE_PERIODE : ''))
const actifs = computed(() => Object.keys(props.filtres).length > 0)

function changerListe(nom: 'action' | 'cibleType', valeur: string): void {
  emit('modifier', { [nom]: valeur === FILTRE_JOURNAL_TOUS ? undefined : valeur })
}

function changerDate(nom: 'du' | 'au', valeur: string): void {
  if (nom === 'du') du.value = valeur
  else au.value = valeur
  if (erreurPeriode.value) return
  emit('modifier', { [nom]: valeur === '' ? undefined : valeur })
}

watchDebounced(cibleId, (valeur) => {
  const propre = valeur.trim()
  if (propre !== (props.filtres.cibleId ?? '')) emit('modifier', { cibleId: propre === '' ? undefined : propre })
}, { debounce: DELAI_IDENTIFIANT_MS })
</script>

<template>
  <form class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtres du journal" @submit.prevent>
    <UFormField label="Action" name="action">
      <USelect
        :model-value="filtres.action ?? FILTRE_JOURNAL_TOUS"
        :items="optionsActions"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        class="w-full"
        @update:model-value="changerListe('action', String($event))"
      />
    </UFormField>
    <UFormField label="Cible" name="cibleType">
      <USelect
        :model-value="filtres.cibleType ?? FILTRE_JOURNAL_TOUS"
        :items="optionsCibles"
        :ui="UI_CHAMP_TACTILE"
        :disabled="desactive"
        class="w-full"
        @update:model-value="changerListe('cibleType', String($event))"
      />
    </UFormField>
    <UFormField label="Identifiant de la cible" name="cibleId">
      <UInput v-model="cibleId" :ui="UI_CHAMP_TACTILE" :disabled="desactive" autocomplete="off" class="w-full" />
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
        @click="emit('reinitialiser')"
      >
        Réinitialiser les filtres
      </UButton>
    </div>
  </form>
</template>
