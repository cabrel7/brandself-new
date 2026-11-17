<script setup lang="ts">
import type { VitrineLigneDto } from '#shared/schemas/admin-a2'
import { etiquettesVitrine, valeurOuTiret } from '~/utils/admin-a2'
import { libellePlan } from '~/utils/admin-paiements'

const props = defineProps<{ vitrine: VitrineLigneDto }>()
const etiquettes = computed(() => etiquettesVitrine(props.vitrine))
</script>

<template>
  <NuxtLink
    :to="`/admin/vitrines/${encodeURIComponent(vitrine.id)}`"
    class="flex min-h-(--cible-tactile) flex-col gap-2 px-1 py-4 hover:bg-accent-doux focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-encre sm:flex-row sm:items-center sm:justify-between sm:gap-4"
  >
    <span class="flex min-w-0 flex-col gap-0.5">
      <span class="truncate font-semibold text-encre">{{ vitrine.nom }}</span>
      <span class="truncate text-base text-texte-secondaire">/{{ vitrine.username }} · {{ valeurOuTiret(vitrine.metier) }}</span>
      <span class="text-(length:--fs-14) text-texte-secondaire">{{ libellePlan(vitrine.plan) }}</span>
    </span>
    <AdminUtilisateurEtiquettes :etiquettes="etiquettes" class="sm:justify-end" />
  </NuxtLink>
</template>
