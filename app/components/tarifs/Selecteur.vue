<script setup lang="ts">
const props = defineProps<{
  items: { value: string, label: string }[]
  /** Nom accessible du groupe (lu par les lecteurs d'écran, non affiché). */
  legende: string
  /** Fond du groupe : `fond` quand le sélecteur repose déjà sur le fond `surface` (page /tarifs). */
  fond?: 'surface' | 'fond'
}>()

const choix = defineModel<string>({ required: true })

// Segment actif plein (accent + texte blanc) : le choix se lit d'un coup d'oeil.
const UI = computed(() => ({
  legend: 'sr-only',
  fieldset: `rounded-(--rayon) border border-bordure p-1 ${props.fond === 'fond' ? 'bg-fond' : 'bg-surface'}`,
  item: 'flex-1 border-transparent has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent has-data-[state=checked]:**:text-sur-accent',
}))
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
