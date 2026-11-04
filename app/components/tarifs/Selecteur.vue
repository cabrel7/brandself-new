<script setup lang="ts">
defineProps<{
  items: { value: string, label: string }[]
  /** Nom accessible du groupe (lu par les lecteurs d'écran, non affiché). */
  legende: string
}>()

const choix = defineModel<string>({ required: true })

// Segment actif plein (accent + texte blanc) : le choix se lit d'un coup d'oeil.
const UI = {
  legend: 'sr-only',
  fieldset: 'rounded-(--rayon) border border-bordure bg-surface p-1',
  item: 'flex-1 border-transparent has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent has-data-[state=checked]:**:text-sur-accent',
}
</script>

<template>
  <URadioGroup
    v-model="choix"
    :legend="legende"
    :items="items"
    variant="table"
    indicator="hidden"
    orientation="horizontal"
    size="lg"
    :ui="UI"
  />
</template>
