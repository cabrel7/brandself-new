<script setup lang="ts">
import type { MoyenPaiementDTO } from '#shared/dto'

const props = defineProps<{
  moyens: MoyenPaiementDTO[]
  disabled?: boolean
  erreur?: string
}>()

const emit = defineEmits<{ choisir: [] }>()
const moyen = defineModel<string>({ required: true })

// Une colonne sous 640 px (cartes lisibles à 390 px), deux colonnes au-delà.
const UI = {
  legend: 'mb-2 text-base font-semibold text-encre',
  item: 'flex-1 bg-champ has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent-doux',
  fieldset: 'flex-col gap-3 sm:flex-row',
}
const idErreur = useId()

const listePays = computed(() => paysDesMoyens(props.moyens))
const plusieursPays = computed(() => listePays.value.length > 1)
const itemsPays = computed(() => listePays.value.map((p) => ({ value: p.code, label: p.libelle })))

// Pays affiché : celui du moyen choisi, sinon (aucun choix) celui du premier moyen du catalogue.
const paysChoisi = ref(props.moyens[0]?.pays ?? '')
watch(
  [() => props.moyens, moyen],
  () => {
    const courant = props.moyens.find((m) => m.id === moyen.value)
    if (courant) paysChoisi.value = courant.pays
    else if (!listePays.value.some((p) => p.code === paysChoisi.value)) paysChoisi.value = listePays.value[0]?.code ?? ''
  },
  { immediate: true },
)

const moyensAffiches = computed(() => (plusieursPays.value ? moyensDuPays(props.moyens, paysChoisi.value) : props.moyens))
const items = computed(() => moyensAffiches.value.map((m) => ({ value: m.id, label: m.libelle })))

function changerPays(code: string): void {
  paysChoisi.value = code
  const premier = moyensDuPays(props.moyens, code)[0]
  if (!premier) return
  moyen.value = premier.id
  emit('choisir')
}
</script>

<template>
  <p v-if="moyens.length === 0" class="m-0 text-base text-texte-secondaire" data-champ="moyen">
    Aucun moyen de paiement n’est proposé pour cette devise.
  </p>
  <p v-else-if="moyens.length === 1" class="m-0 text-base text-encre">
    Paiement par <span class="font-semibold">{{ moyens[0]?.libelle }}</span>
  </p>
  <div v-else class="flex flex-col gap-4" data-champ="moyen">
    <UFormField v-if="plusieursPays" label="Pays" name="pays">
      <USelect
        :model-value="paysChoisi"
        :items="itemsPays"
        class="w-full sm:w-72"
        :disabled="disabled"
        @update:model-value="changerPays(String($event))"
      />
    </UFormField>
    <div class="flex flex-col gap-2">
      <URadioGroup
        v-model="moyen"
        legend="Payer avec"
        :items="items"
        variant="card"
        orientation="horizontal"
        size="lg"
        :disabled="disabled"
        :ui="UI"
        :aria-describedby="erreur ? idErreur : undefined"
        @update:model-value="emit('choisir')"
      />
      <p v-if="erreur" :id="idErreur" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreur }}</span>
      </p>
    </div>
  </div>
</template>
