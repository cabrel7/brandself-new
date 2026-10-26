<script setup lang="ts">
// Type de service -> libellé affiché (vocabulaire du produit).
const LIBELLES: Record<string, string> = {
  rdv: 'Rendez-vous',
  accompagnement: 'Accompagnement',
  atelier: 'Atelier',
  devis: 'Sur devis',
}

const props = defineProps<{
  valeur: string
}>()

const libelle = computed(() => LIBELLES[props.valeur] ?? props.valeur)
const estRendezVous = computed(() => props.valeur === 'rdv')
</script>

<template>
  <UBadge
    :color="estRendezVous ? 'primary' : 'neutral'"
    :variant="estRendezVous ? 'solid' : 'outline'"
    size="md"
  >
    {{ libelle }}
  </UBadge>
</template>
