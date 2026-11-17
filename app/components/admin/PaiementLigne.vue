<script setup lang="ts">
import type { PaiementDto } from '#shared/schemas/admin-paiements'
import { formaterDateHeureAdmin, formaterMontantAdmin, LIBELLES_SOURCE } from '~/utils/admin-paiements'

// Une ligne de la liste des paiements : empilée sur mobile, sur une seule rangée dès 768 px. Le bouton « Détail »
// est toujours visible et fait 44 px de haut.
const props = defineProps<{ paiement: PaiementDto }>()
const emit = defineEmits<{ detail: [id: string] }>()

const email = computed(() => props.paiement.utilisateur?.email ?? 'Compte supprimé')
</script>

<template>
  <div class="flex flex-col gap-3 px-1 py-4 md:flex-row md:items-center md:gap-6">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="truncate font-semibold text-encre" :title="email">{{ email }}</span>
      <span class="text-(length:--fs-14) text-texte-secondaire">
        {{ formaterDateHeureAdmin(paiement.creeLe) }} · {{ LIBELLES_SOURCE[paiement.source] }}
      </span>
    </div>
    <div class="flex items-center justify-between gap-4 md:justify-end">
      <span class="font-medium text-encre">{{ formaterMontantAdmin(paiement.montant, paiement.devise) }}</span>
      <AdminPaiementStatutBadge :statut="paiement.statut" />
    </div>
    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-ph-arrow-square-out"
      class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
      :aria-label="`Voir le paiement de ${email}`"
      @click="emit('detail', paiement.id)"
    >
      Détail
    </UButton>
  </div>
</template>
