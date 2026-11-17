<script setup lang="ts">
import { accorder } from '~/utils/pluriel'

// Bloc « Filtres » : fermé par défaut sur mobile (les filtres ne repoussent pas la liste), ouvert sur grand écran.
// Le compteur dit combien de filtres sont actifs, même bloc fermé.
const props = defineProps<{ actifs: number }>()

const GRAND_ECRAN = '(min-width: 1024px)'

const grand = useMediaQuery(GRAND_ECRAN)
const ouvert = ref(grand.value)
watch(grand, (valeur) => { ouvert.value = valeur })

const idContenu = useId()
const libelle = computed(() =>
  props.actifs > 0 ? `Filtres, ${props.actifs} ${accorder(props.actifs, 'actif', 'actifs')}` : 'Filtres',
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-ph-sliders-horizontal"
      :trailing-icon="ouvert ? 'i-ph-caret-up' : 'i-ph-caret-down'"
      class="min-h-(--cible-tactile) self-start"
      :aria-expanded="ouvert"
      :aria-controls="idContenu"
      @click="ouvert = !ouvert"
    >
      {{ libelle }}
    </UButton>
    <div v-show="ouvert" :id="idContenu" class="flex flex-col gap-4">
      <slot />
    </div>
  </div>
</template>
