<script setup lang="ts">
import type { AbonnementAdminDto } from '#shared/schemas/admin-paiements'
import {
  formaterDate,
  formaterMontantAdmin,
  LIBELLES_ETAT_ABONNEMENT,
  LIBELLES_ORIGINE,
  LIBELLES_STATUT,
  libellePlan,
} from '~/utils/admin-paiements'

// Une ligne de la liste des abonnements : empilée sur mobile, sur une seule rangée dès 768 px. Le rappel n'est proposé
// que si la page le permet (abonnement non échu).
defineProps<{ abonnement: AbonnementAdminDto, rappelPossible: boolean }>()
const emit = defineEmits<{ rappel: [abonnement: AbonnementAdminDto] }>()
</script>

<template>
  <div class="flex flex-col gap-3 px-1 py-4 md:flex-row md:items-center md:gap-6">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="truncate font-semibold text-encre" :title="abonnement.utilisateur.email">{{ abonnement.utilisateur.email }}</span>
      <span class="text-(length:--fs-14) text-texte-secondaire">
        {{ libellePlan(abonnement.plan) }} · {{ abonnement.devise }} · {{ LIBELLES_ORIGINE[abonnement.origine] }}
      </span>
      <span class="text-(length:--fs-14) text-texte-secondaire">
        <template v-if="abonnement.dernierPaiement">
          Dernier paiement : {{ formaterMontantAdmin(abonnement.dernierPaiement.montant, abonnement.dernierPaiement.devise) }},
          {{ LIBELLES_STATUT[abonnement.dernierPaiement.statut].toLowerCase() }}
          le {{ formaterDate(abonnement.dernierPaiement.creeLe) }}
        </template>
        <template v-else>Aucun paiement</template>
      </span>
    </div>
    <div class="flex items-center justify-between gap-4 md:justify-end">
      <span class="text-encre">Échéance {{ formaterDate(abonnement.expireLe) }}</span>
      <UBadge color="neutral" variant="subtle" size="lg">{{ LIBELLES_ETAT_ABONNEMENT[abonnement.etat] }}</UBadge>
    </div>
    <UButton
      v-if="rappelPossible"
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-ph-paper-plane-tilt"
      class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
      :aria-label="`Envoyer un rappel à ${abonnement.utilisateur.email}`"
      @click="emit('rappel', abonnement)"
    >
      Envoyer un rappel
    </UButton>
  </div>
</template>
