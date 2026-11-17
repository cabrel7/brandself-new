<script setup lang="ts">
import { ADMIN_MOTIF_MAX } from '#shared/admin'
import type { AdminAction, AdminCible } from '#shared/admin'
import { codeReauthValide } from '~/utils/admin-a2'
import { MESSAGE_MOTIF, motifValide, nouvelleCleIdempotence } from '~/utils/admin-paiements'

// Confirmation d'une écriture d'administration (réglage, relance ou purge de tâches, capacité) : motif obligatoire,
// code reçu par e-mail si l'action l'exige. La boîte ne fait aucun appel d'écriture : elle émet la saisie et la clé
// d'idempotence, l'écriture est faite par le composable de la page. Même parcours que `AdminReauthDialog` (A2), dont
// les définitions d'actions sont propres à A2.
const CODE_LENGTH = 6
const AIDE_CODE = 'Un code à 6 chiffres est envoyé à votre adresse e-mail.'

const props = defineProps<{
  titre: string
  description: string
  libelleAction: string
  reauth: boolean
  /** Action, type de cible et cible auxquels le code de réauthentification est lié (A1). */
  action: AdminAction
  cibleType: AdminCible
  cibleId: string
  enCours: boolean
  erreur: string
  destructive?: boolean
}>()
const ouvert = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirmer: [saisie: { motif: string, code: string, cle: string }] }>()

const reauthCode = useReauthCode()

const motif = ref('')
const chiffres = ref<number[]>([])
// Une même intention garde sa clé (rejeu sûr après une coupure) ; si la saisie change, c'est une autre demande.
const cle = ref(nouvelleCleIdempotence())

const code = computed(() =>
  Array.from({ length: CODE_LENGTH }, (_, i) => chiffres.value[i]).filter((c) => typeof c === 'number').join(''),
)
const valide = computed(() => motifValide(motif.value) && (!props.reauth || codeReauthValide(code.value)))
const motifRestant = computed(() => ADMIN_MOTIF_MAX - motif.value.length)

watch(ouvert, (estOuvert) => {
  if (!estOuvert) return
  motif.value = ''
  chiffres.value = []
  reauthCode.reinitialiser()
  cle.value = nouvelleCleIdempotence()
})

watch(motif, () => {
  cle.value = nouvelleCleIdempotence()
})

// Un code est à usage unique : après un refus, on en redemande un.
watch(() => props.erreur, (message) => {
  if (message) chiffres.value = []
})

async function demanderCode(): Promise<void> {
  chiffres.value = []
  await reauthCode.demander(props.action, props.cibleType, props.cibleId)
}

function confirmer(): void {
  if (!valide.value || props.enCours) return
  emit('confirmer', { motif: motif.value, code: code.value, cle: cle.value })
}
</script>

<template>
  <UModal v-model:open="ouvert" :title="titre" :description="description" :dismissible="!enCours" :close="!enCours">
    <template #body>
      <form class="flex flex-col gap-5" novalidate @submit.prevent="confirmer">
        <slot />

        <UFormField label="Motif" name="motif" required :help="motifValide(motif) ? undefined : MESSAGE_MOTIF">
          <UTextarea v-model="motif" :rows="3" :maxlength="ADMIN_MOTIF_MAX" autofocus class="w-full" :disabled="enCours" />
          <template #hint>
            <span class="text-(length:--fs-14) text-texte-secondaire" aria-live="polite">{{ motifRestant }} caractères restants</span>
          </template>
        </UFormField>

        <div v-if="reauth" class="flex flex-col gap-3">
          <p class="m-0 font-medium text-encre">
            Code de confirmation
          </p>
          <template v-if="!reauthCode.envoye.value">
            <p class="m-0 text-base text-texte-secondaire">
              {{ AIDE_CODE }}
            </p>
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              icon="i-ph-envelope-simple"
              class="min-h-(--cible-tactile) self-start"
              :loading="reauthCode.enCours.value"
              :disabled="enCours"
              @click="demanderCode"
            >
              Recevoir le code
            </UButton>
          </template>
          <template v-else>
            <UPinInput
              v-model="chiffres"
              type="number"
              otp
              :length="CODE_LENGTH"
              :disabled="enCours"
              aria-label="Code de confirmation à 6 chiffres"
            />
            <p v-if="reauthCode.secondesRestantes.value > 0" class="m-0 text-base text-texte-secondaire" role="status">
              Code envoyé. Vous pourrez en demander un autre dans {{ reauthCode.secondesRestantes.value }} s.
            </p>
            <UButton
              v-else
              color="neutral"
              variant="link"
              size="lg"
              class="-ml-3 min-h-(--cible-tactile) self-start"
              :loading="reauthCode.enCours.value"
              :disabled="enCours"
              @click="demanderCode"
            >
              Recevoir un nouveau code
            </UButton>
          </template>
          <p v-if="reauthCode.erreur.value" role="alert" class="message-erreur m-0">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ reauthCode.erreur.value }}</span>
          </p>
        </div>

        <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile) justify-center" :disabled="enCours" @click="ouvert = false">
          Annuler
        </UButton>
        <UButton
          :color="destructive ? 'error' : 'primary'"
          size="lg"
          class="min-h-(--cible-tactile) justify-center"
          :loading="enCours"
          :disabled="!valide"
          @click="confirmer"
        >
          {{ libelleAction }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
