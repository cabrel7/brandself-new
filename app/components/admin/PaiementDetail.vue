<script setup lang="ts">
import {
  formaterDateHeureAdmin,
  formaterMontantAdmin,
  formaterMontantOuTiret,
  libellePeriodeAdmin,
  libellePlan,
  LIBELLES_SOURCE,
  peutMarquerPaye,
  peutReverifier,
} from '~/utils/admin-paiements'

// Tiroir du détail d'un paiement (identifiant dans l'URL). Les actions restent en ligne : un seul formulaire à la fois.
const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ fermer: [], modifie: [] }>()

type Action = 'reverifier' | 'marquer'

const idRef = computed(() => props.id)
const {
  data, status, error, refresh,
  actionEnCours, erreurAction, confirmation, reinitialiserMessages,
  reverifier, demanderCode, marquerPaye,
} = useAdminPaiementDetail(idRef)

const ouvert = computed({
  get: () => props.id !== null,
  set: (valeur: boolean) => {
    if (!valeur) emit('fermer')
  },
})

const action = ref<Action | null>(null)
const { ready: squeletteVisible } = useTimeout(200, { controls: true })

// Changer de paiement repart d'un tiroir propre.
watch(idRef, () => {
  action.value = null
  reinitialiserMessages()
})

const paiement = computed(() => data.value?.paiement ?? null)

function ouvrirAction(valeur: Action): void {
  reinitialiserMessages()
  action.value = valeur
}

function annulerAction(): void {
  reinitialiserMessages()
  action.value = null
}

async function lancerReverification(motif: string): Promise<void> {
  if (await reverifier(motif, cleReverification.value)) {
    action.value = null
    emit('modifie')
  }
}

// Une clé par ouverture du formulaire de revérification, conservée pour les essais suivants.
const cleReverification = ref(nouvelleCleIdempotence())
watch(action, (valeur) => {
  if (valeur === 'reverifier') cleReverification.value = nouvelleCleIdempotence()
})

async function lancerMarquage(donnees: { motif: string, cleIdempotence: string, code: string }): Promise<void> {
  if (await marquerPaye(donnees.motif, donnees.cleIdempotence, donnees.code)) {
    action.value = null
    emit('modifie')
  }
}
</script>

<template>
  <USlideover
    v-model:open="ouvert"
    side="right"
    :close="{ class: 'min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center' }"
    title="Détail du paiement"
    :description="paiement?.reference"
    :dismissible="!actionEnCours"
  >
    <template #body>
      <div v-if="status === 'pending' || status === 'idle'" class="flex flex-col gap-3" aria-busy="true">
        <template v-if="squeletteVisible">
          <USkeleton class="h-6 w-40" />
          <USkeleton class="h-4 w-64 max-w-full" />
          <USkeleton class="h-4 w-56 max-w-full" />
        </template>
      </div>

      <div v-else-if="error || !data || !paiement" class="flex flex-col items-start gap-4">
        <UAlert
          role="alert"
          color="error"
          variant="soft"
          icon="i-ph-warning-circle"
          description="Nous n’avons pas pu charger ce paiement."
          class="w-full"
        />
        <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" class="min-h-(--cible-tactile)" @click="() => refresh()">
          Réessayer
        </UButton>
      </div>

      <div v-else class="flex flex-col gap-8">
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
          <dt class="text-muted">Statut</dt>
          <dd><AdminPaiementStatutBadge :statut="paiement.statut" /></dd>
          <dt class="text-muted">Montant</dt>
          <dd class="font-medium">{{ formaterMontantAdmin(paiement.montant, paiement.devise) }}</dd>
          <dt class="text-muted">Frais K-PAY</dt>
          <dd>{{ formaterMontantOuTiret(paiement.fraisReels, paiement.devise) }}</dd>
          <dt class="text-muted">Net K-PAY</dt>
          <dd>{{ formaterMontantOuTiret(paiement.netReel, paiement.devise) }}</dd>
          <dt class="text-muted">Utilisateur</dt>
          <dd class="min-w-0 break-words">{{ paiement.utilisateur?.email ?? 'Compte supprimé' }}</dd>
          <dt class="text-muted">Abonnement</dt>
          <dd>{{ libellePlan(paiement.plan) }}, {{ libellePeriodeAdmin(paiement.periodeMois) }}</dd>
          <dt class="text-muted">Source</dt>
          <dd>{{ LIBELLES_SOURCE[paiement.source] }}</dd>
          <dt class="text-muted">Moyen</dt>
          <dd>{{ paiement.operateur ?? paiement.methode }}</dd>
          <dt v-if="paiement.codeEchec" class="text-muted">Motif d’échec</dt>
          <dd v-if="paiement.codeEchec" class="break-words">{{ paiement.codeEchec }}</dd>
          <dt class="text-muted">Créé le</dt>
          <dd>{{ formaterDateHeureAdmin(paiement.creeLe) }}</dd>
          <dt v-if="paiement.appliqueLe" class="text-muted">Appliqué le</dt>
          <dd v-if="paiement.appliqueLe">{{ formaterDateHeureAdmin(paiement.appliqueLe) }}</dd>
          <dt v-if="paiement.termineLe" class="text-muted">Terminé le</dt>
          <dd v-if="paiement.termineLe">{{ formaterDateHeureAdmin(paiement.termineLe) }}</dd>
        </dl>

        <section aria-labelledby="titre-evenements" class="flex flex-col gap-3">
          <h3 id="titre-evenements" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">
            Événements reçus
          </h3>
          <p v-if="data.evenements.length === 0" class="text-muted">Aucun événement reçu pour ce paiement.</p>
          <ul v-else class="divide-y divide-(--bordure)">
            <li v-for="evenement in data.evenements" :key="`${evenement.recuLe}-${evenement.evenement}-${evenement.source}`" class="flex flex-col gap-1 py-3">
              <span class="font-medium">{{ evenement.evenement }}</span>
              <span class="text-muted">
                {{ evenement.source === 'webhook' ? 'Notification K-PAY' : 'Interrogation' }},
                {{ formaterDateHeureAdmin(evenement.recuLe) }}
              </span>
              <span class="text-muted">
                Traitement : {{ evenement.traitement }}<template v-if="evenement.motif"> ({{ evenement.motif }})</template>
              </span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="titre-actions" class="flex flex-col gap-4">
          <h3 id="titre-actions" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">
            Actions
          </h3>

          <UAlert
            v-if="confirmation"
            role="status"
            color="neutral"
            variant="soft"
            icon="i-ph-check-circle"
            :description="confirmation"
          />
          <UAlert
            v-else-if="erreurAction && action === null"
            role="alert"
            color="error"
            variant="soft"
            icon="i-ph-warning-circle"
            :description="erreurAction"
          />

          <AdminPaiementMotifForm
            v-if="action === 'reverifier'"
            libelle-action="Revérifier"
            :en-cours="actionEnCours"
            :erreur="erreurAction"
            @confirmer="lancerReverification"
            @annuler="annulerAction"
          />
          <AdminPaiementReauth
            v-else-if="action === 'marquer'"
            :en-cours="actionEnCours"
            :erreur="erreurAction"
            :demander-code="demanderCode"
            @confirmer="lancerMarquage"
            @annuler="annulerAction"
          />
          <template v-else>
            <p v-if="!peutReverifier(paiement) && !peutMarquerPaye(paiement)" class="text-muted">
              Aucune action n’est possible sur ce paiement.
            </p>
            <p v-if="data.reverifieNonReussiLe && peutMarquerPaye(paiement)" class="text-muted">
              Dernière revérification sans encaissement : {{ formaterDateHeureAdmin(data.reverifieNonReussiLe) }}.
            </p>
            <div class="flex flex-col gap-3 sm:flex-row">
              <UButton
                v-if="peutReverifier(paiement)"
                color="neutral"
                variant="outline"
                size="lg"
                class="min-h-(--cible-tactile) justify-center"
                icon="i-ph-arrows-clockwise"
                @click="ouvrirAction('reverifier')"
              >
                Revérifier auprès de K-PAY
              </UButton>
              <UButton v-if="peutMarquerPaye(paiement)" size="lg" class="min-h-(--cible-tactile) justify-center" icon="i-ph-check-circle" @click="ouvrirAction('marquer')">
                Marquer comme payé
              </UButton>
            </div>
          </template>
        </section>
      </div>
    </template>
  </USlideover>
</template>
