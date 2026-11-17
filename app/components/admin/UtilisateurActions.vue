<script setup lang="ts">
import type { UtilisateurFicheDto } from '#shared/schemas/admin-a2'
import { ACTIONS_A2 } from '~/utils/admin-a2'
import type { DefinitionActionA2, IdActionA2 } from '~/utils/admin-a2'

// Actions d'un compte. La liste affichée suit l'état du compte ; le serveur reste la seule autorité.
const props = defineProps<{ utilisateur: UtilisateurFicheDto }>()
const emit = defineEmits<{ fait: [id: IdActionA2] }>()

interface Bouton {
  definition: DefinitionActionA2
  icone: string
  desactive: boolean
  raison?: string
}

const actionOuverte = ref<DefinitionActionA2 | null>(null)
const dialogueOuvert = ref(false)

const groupes = computed<Array<{ titre: string, boutons: Bouton[] }>>(() => {
  const u = props.utilisateur
  return [
    {
      titre: 'Abonnement',
      boutons: [
        { definition: ACTIONS_A2.offrir_jours, icone: 'i-ph-gift', desactive: false },
        u.plan === 'payant'
          ? { definition: ACTIONS_A2.plan_gratuit, icone: 'i-ph-arrow-circle-down', desactive: false }
          : { definition: ACTIONS_A2.plan_payant, icone: 'i-ph-arrow-circle-up', desactive: false },
      ],
    },
    {
      titre: 'Accès',
      boutons: [
        u.suspendu
          ? { definition: ACTIONS_A2.reactiver, icone: 'i-ph-play-circle', desactive: false }
          : { definition: ACTIONS_A2.suspendre, icone: 'i-ph-prohibit', desactive: false },
        {
          definition: ACTIONS_A2.revoquer_sessions,
          icone: 'i-ph-devices',
          desactive: u.sessionsActives.length === 0,
          raison: 'Aucun appareil connecté.',
        },
        {
          definition: ACTIONS_A2.retirer_assistants,
          icone: 'i-ph-plugs',
          desactive: u.assistants.length === 0,
          raison: 'Aucun assistant connecté.',
        },
      ],
    },
    {
      titre: 'Suppression',
      boutons: [{ definition: ACTIONS_A2.supprimer, icone: 'i-ph-trash', desactive: false }],
    },
  ]
})

function apresAction(): void {
  if (actionOuverte.value) emit('fait', actionOuverte.value.id)
}

function ouvrir(definition: DefinitionActionA2): void {
  actionOuverte.value = definition
  dialogueOuvert.value = true
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-for="groupe in groupes" :key="groupe.titre" class="flex flex-col gap-2">
      <h3 class="m-0 text-base font-semibold text-texte-secondaire">
        {{ groupe.titre }}
      </h3>
      <ul class="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:flex-wrap">
        <li v-for="bouton in groupe.boutons" :key="bouton.definition.id" class="flex flex-col gap-1">
          <UButton
            :color="bouton.definition.destructive ? 'error' : 'neutral'"
            variant="outline"
            size="lg"
            :icon="bouton.icone"
            class="min-h-(--cible-tactile) justify-center"
            :disabled="bouton.desactive"
            @click="ouvrir(bouton.definition)"
          >
            {{ bouton.definition.libelle }}
          </UButton>
          <span v-if="bouton.desactive && bouton.raison" class="text-(length:--fs-14) text-texte-secondaire">{{ bouton.raison }}</span>
        </li>
      </ul>
    </div>
  </div>

  <AdminReauthDialog
    v-if="actionOuverte"
    v-model:open="dialogueOuvert"
    :definition="actionOuverte"
    :cible-id="utilisateur.id"
    :email-attendu="utilisateur.email"
    @reussi="apresAction"
  />
</template>
