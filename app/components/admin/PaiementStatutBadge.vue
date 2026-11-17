<script setup lang="ts">
import type { PaiementStatut } from '#shared/paiements'
import { COULEURS_STATUT, LIBELLES_STATUT } from '~/utils/admin-paiements'

defineProps<{ statut: PaiementStatut }>()
</script>

<template>
  <UBadge :color="COULEURS_STATUT[statut]" variant="subtle" size="lg">
    {{ LIBELLES_STATUT[statut] }}
  </UBadge>
</template>
