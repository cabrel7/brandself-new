<script setup lang="ts">
import type { MoyenPaiementDTO } from '#shared/dto'

const props = defineProps<{
  moyens: MoyenPaiementDTO[]
  disabled?: boolean
  erreur?: string
}>()

const emit = defineEmits<{ choisir: [] }>()
const moyen = defineModel<string>({ required: true })

const UI = { legend: 'mb-2 text-base font-semibold text-encre', item: 'flex-1 bg-champ', fieldset: 'gap-3' }

const items = computed(() => props.moyens.map((m) => ({ value: m.id, label: m.libelle })))
</script>

<template>
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
      @update:model-value="emit('choisir')"
    />
    <p v-if="erreur" role="alert" class="message-erreur">
      <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
      <span>{{ erreur }}</span>
    </p>
  </div>
</template>
