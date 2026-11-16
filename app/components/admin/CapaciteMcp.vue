<script setup lang="ts">
import { formaterDateHeureAdmin } from '~/utils/admin-paiements'

// Capacité « assistants » (MCP) accordée à un compte par l'administration, indépendamment de son plan. L'état courant
// est lu de la fiche (`capacites`) ; après une action, la fiche est rechargée par le parent. Accorder exige un code de confirmation ; révoquer, un motif.
const props = defineProps<{ utilisateurId: string, capacites: readonly string[] }>()
const emit = defineEmits<{ modifie: [] }>()

const { dialogue, dialogueOuvert, enCours, erreur, derniere, ouvrir, confirmer } = useAdminCapacites(() => props.utilisateurId, () => emit('modifie'))

const accordee = computed(() => props.capacites.includes('mcp'))
const resultat = computed(() => {
  const capacite = derniere.value
  if (!capacite) return ''
  return capacite.revoqueLe === null
    ? `Capacité accordée le ${formaterDateHeureAdmin(capacite.accordeLe)}.`
    : `Capacité révoquée le ${formaterDateHeureAdmin(capacite.revoqueLe)}.`
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="m-0 text-base text-texte-secondaire">
      Permet à ce compte de connecter des assistants à sa vitrine, même si son plan ne l’inclut pas.
      La connexion des assistants doit aussi être activée dans les réglages.
    </p>
    <p v-if="resultat" role="status" class="m-0 text-base text-encre">
      {{ resultat }}
    </p>
    <ul class="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:flex-wrap">
      <li v-if="!accordee">
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-ph-plugs-connected"
          class="min-h-(--cible-tactile) justify-center max-sm:w-full"
          @click="ouvrir('accorder')"
        >
          Accorder la capacité
        </UButton>
      </li>
      <li v-else>
        <UButton
          color="error"
          variant="outline"
          size="lg"
          icon="i-ph-plugs"
          class="min-h-(--cible-tactile) justify-center max-sm:w-full"
          @click="ouvrir('revoquer')"
        >
          Révoquer la capacité
        </UButton>
      </li>
    </ul>

    <AdminSupervisionConfirmation
      v-model:open="dialogueOuvert"
      :titre="dialogue.titre"
      :description="dialogue.description"
      :libelle-action="dialogue.libelleAction"
      :reauth="dialogue.reauth"
      :action="dialogue.action"
      :cible-type="dialogue.cibleType"
      :cible-id="dialogue.cibleId"
      :destructive="dialogue.destructive"
      :en-cours="enCours"
      :erreur="erreur"
      @confirmer="confirmer"
    />
  </div>
</template>
