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

const items = computed(() => props.moyens.map((m) => ({ value: m.id, label: m.libelle })))
</script>

<template>
  <p v-if="moyens.length === 1" class="m-0 text-base text-encre">
    Paiement par <span class="font-semibold">{{ moyens[0]?.libelle }}</span>
  </p>
  <div v-else class="flex flex-col gap-2" data-champ="moyen">
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
</template>
