<script setup lang="ts">
// Boîte de dialogue à motif obligatoire pour les actions lancées depuis une page (rappel, export). Depuis le tiroir
// d'un paiement, les actions restent en ligne : jamais de fenêtre sur fenêtre.
defineProps<{
  titre: string
  description?: string
  libelleAction: string
  enCours: boolean
  erreur: string
}>()
const emit = defineEmits<{ confirmer: [motif: string] }>()
const ouvert = defineModel<boolean>('open', { required: true })
</script>

<template>
  <UModal v-model:open="ouvert" :title="titre" :description="description" :dismissible="!enCours">
    <template #body>
      <AdminPaiementMotifForm
        :libelle-action="libelleAction"
        :en-cours="enCours"
        :erreur="erreur"
        @confirmer="emit('confirmer', $event)"
        @annuler="ouvert = false"
      />
    </template>
  </UModal>
</template>
