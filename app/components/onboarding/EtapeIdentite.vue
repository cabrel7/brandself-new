<script setup lang="ts">
import { METIERS_SUGGERES } from '#shared/onboarding'
import {
  displayName, METIER_MAX, NOM_MAX, PAYS, PRENOM_MAX, TITRE_LABELS, TITRES, VILLE_MAX,
} from '#shared/vitrine'
import type { ErreursOnboarding } from '~/composables/useOnboarding'

const props = defineProps<{
  erreurs: ErreursOnboarding
  desactive: boolean
}>()

const emit = defineEmits<{ soumettre: [] }>()

const identite = defineModel<IdentiteForm>({ required: true })

const TITRE_ITEMS = [
  { label: 'Sans titre', value: TITRE_AUCUN },
  ...TITRES.map((titre) => ({ label: TITRE_LABELS[titre], value: titre })),
]
const PAYS_ITEMS = PAYS.map((pays) => ({ label: pays.label, value: pays.code }))

// Saisie libre : les suggestions sont typées `string[]` pour que `v-model` accepte toute chaîne.
const METIER_ITEMS: string[] = [...METIERS_SUGGERES]
const racine = useTemplateRef<HTMLFormElement>('racine')

const nomAffiche = computed(() =>
  displayName(versTitre(identite.value.titre), identite.value.prenom, identite.value.nom),
)

function focusErreur(): void {
  racine.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

defineExpose({ focusErreur })
</script>

<template>
  <form ref="racine" class="flex flex-col gap-4" novalidate @submit.prevent="emit('soumettre')">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <UFormField label="Titre" name="titre" :error="props.erreurs.titre">
        <USelect v-model="identite.titre" :items="TITRE_ITEMS" value-key="value" :disabled="desactive" class="w-full" />
      </UFormField>
      <UFormField label="Prénom" name="prenom" required :error="props.erreurs.prenom">
        <UInput
          v-model="identite.prenom"
          autocomplete="given-name"
          :maxlength="PRENOM_MAX"
          :disabled="desactive"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField label="Nom" name="nom" required :error="props.erreurs.nom">
      <UInput
        v-model="identite.nom"
        autocomplete="family-name"
        :maxlength="NOM_MAX"
        :disabled="desactive"
        class="w-full"
      />
      <template v-if="nomAffiche" #help>
        Affiché sur la vitrine : {{ nomAffiche }}
      </template>
    </UFormField>

    <UFormField label="Métier" name="metier" required :error="props.erreurs.metier">
      <UInputMenu
        v-model="identite.metier"
        mode="autocomplete"
        :items="METIER_ITEMS"
        autocomplete="organization-title"
        :maxlength="METIER_MAX"
        :disabled="desactive"
        class="w-full"
      />
    </UFormField>

    <div class="grid grid-cols-2 gap-4">
      <UFormField label="Ville" name="ville" required :error="props.erreurs.ville">
        <UInput
          v-model="identite.ville"
          autocomplete="address-level2"
          :maxlength="VILLE_MAX"
          :disabled="desactive"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Pays" name="pays" required :error="props.erreurs.pays">
        <USelect v-model="identite.pays" :items="PAYS_ITEMS" value-key="value" :disabled="desactive" class="w-full" />
      </UFormField>
    </div>
  </form>
</template>
