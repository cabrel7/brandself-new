<script setup lang="ts">
import { ADMIN_MOTIF_MAX } from '#shared/admin'
import { ADMIN_EMAIL_CONFIRMATION_MAX, ADMIN_JOURS_MAX, ADMIN_JOURS_MIN } from '#shared/admin-a2'
import {
  JOURS_PAR_DEFAUT,
  cheminAction,
  corpsAction,
  saisieActionValide,
} from '~/utils/admin-a2'
import type { DefinitionActionA2 } from '~/utils/admin-a2'
import { MESSAGE_MOTIF, MESSAGE_REJOUE, motifValide, nouvelleCleIdempotence } from '~/utils/admin-paiements'

const CODE_LENGTH = 6
const AIDE_EMAIL = 'Saisissez l’adresse e-mail exacte du compte pour confirmer.'

const props = defineProps<{
  definition: DefinitionActionA2
  /** Identifiant de la cible (utilisateur, vitrine ou consentement d'assistant). */
  cibleId: string
  /** E-mail à ressaisir pour une suppression. */
  emailAttendu?: string
}>()
const ouvert = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ reussi: [] }>()

const toast = useToast()
const { ecrire } = useAdminEcriture()
const reauth = useReauthCode()

const motif = ref('')
const jours = ref<number | null>(JOURS_PAR_DEFAUT)
const emailSaisi = ref('')
const chiffres = ref<number[]>([])
const enCours = ref(false)
const erreur = ref('')
// Une même intention garde sa clé (rejeu sûr après une coupure) ; si la saisie change, c'est une autre demande.
const cle = ref(nouvelleCleIdempotence())

const code = computed(() => Array.from({ length: CODE_LENGTH }, (_, i) => chiffres.value[i]).filter((c) => typeof c === 'number').join(''))
const saisie = computed(() => ({
  motif: motif.value,
  code: code.value,
  jours: jours.value ?? 0,
  emailConfirmation: emailSaisi.value,
}))
const valide = computed(() => saisieActionValide(props.definition, saisie.value, props.emailAttendu ?? ''))
const motifRestant = computed(() => ADMIN_MOTIF_MAX - motif.value.length)

watch(ouvert, (estOuvert) => {
  if (!estOuvert) return
  motif.value = ''
  jours.value = JOURS_PAR_DEFAUT
  emailSaisi.value = ''
  chiffres.value = []
  erreur.value = ''
  reauth.reinitialiser()
  cle.value = nouvelleCleIdempotence()
})

watch([motif, jours, emailSaisi], () => {
  cle.value = nouvelleCleIdempotence()
})

async function demanderCode(): Promise<void> {
  chiffres.value = []
  await reauth.demander(props.definition.action, props.definition.cibleType, props.cibleId)
}

async function confirmer(): Promise<void> {
  if (!valide.value || enCours.value) return
  enCours.value = true
  erreur.value = ''
  const resultat = await ecrire<{ rejoue?: boolean }>(
    cheminAction(props.definition.id, props.cibleId),
    corpsAction(props.definition.id, saisie.value),
    { cle: cle.value, code: props.definition.reauth ? code.value : undefined },
  )
  enCours.value = false
  if (!resultat.ok) {
    erreur.value = resultat.message
    // Un code est à usage unique : après un échec, on en redemande un.
    chiffres.value = []
    return
  }
  toast.add({
    title: resultat.donnees.rejoue === true ? MESSAGE_REJOUE : props.definition.succes,
    color: 'success',
    icon: 'i-ph-check-circle',
  })
  ouvert.value = false
  emit('reussi')
}
</script>

<template>
  <UModal
    v-model:open="ouvert"
    :title="definition.titre"
    :description="definition.description"
    :dismissible="!enCours"
    :close="!enCours"
  >
    <template #body>
      <form class="flex flex-col gap-5" novalidate @submit.prevent="confirmer">
        <UFormField
          label="Motif"
          name="motif"
          required
          :help="motifValide(motif) ? undefined : MESSAGE_MOTIF"
        >
          <UTextarea
            v-model="motif"
            :rows="3"
            :maxlength="ADMIN_MOTIF_MAX"
            autofocus
            class="w-full"
            :disabled="enCours"
          />
          <template #hint>
            <span class="text-(length:--fs-14) text-texte-secondaire" aria-live="polite">{{ motifRestant }} caractères restants</span>
          </template>
        </UFormField>

        <UFormField
          v-if="definition.jours"
          label="Nombre de jours"
          name="jours"
          required
          :help="`De ${ADMIN_JOURS_MIN} à ${ADMIN_JOURS_MAX} jours.`"
        >
          <UInputNumber
            v-model="jours"
            :min="ADMIN_JOURS_MIN"
            :max="ADMIN_JOURS_MAX"
            :step="1"
            size="lg"
            class="w-full"
            :disabled="enCours"
          />
        </UFormField>

        <UFormField
          v-if="definition.emailConfirmation"
          label="Adresse e-mail du compte"
          name="emailConfirmation"
          required
          :help="AIDE_EMAIL"
        >
          <UInput
            v-model="emailSaisi"
            type="email"
            inputmode="email"
            autocomplete="off"
            size="lg"
            :maxlength="ADMIN_EMAIL_CONFIRMATION_MAX"
            class="w-full"
            :disabled="enCours"
          />
        </UFormField>

        <div v-if="definition.reauth" class="flex flex-col gap-3">
          <p class="m-0 font-medium text-encre">
            Code de confirmation
          </p>
          <template v-if="!reauth.envoye.value">
            <p class="m-0 text-base text-texte-secondaire">
              Un code à 6 chiffres est envoyé à votre adresse e-mail.
            </p>
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              icon="i-ph-envelope-simple"
              class="min-h-(--cible-tactile) self-start"
              :loading="reauth.enCours.value"
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
              autofocus
              :length="CODE_LENGTH"
              :disabled="enCours"
              aria-label="Code de confirmation à 6 chiffres"
            />
            <p v-if="reauth.secondesRestantes.value > 0" class="m-0 text-base text-texte-secondaire" role="status">
              Code envoyé. Vous pourrez en demander un autre dans {{ reauth.secondesRestantes.value }} s.
            </p>
            <UButton
              v-else
              color="neutral"
              variant="link"
              size="lg"
              class="-ml-3 min-h-(--cible-tactile) self-start"
              :loading="reauth.enCours.value"
              :disabled="enCours"
              @click="demanderCode"
            >
              Recevoir un nouveau code
            </UButton>
          </template>
          <p v-if="reauth.erreur.value" role="alert" class="message-erreur m-0">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ reauth.erreur.value }}</span>
          </p>
        </div>

        <UAlert
          v-if="erreur"
          role="alert"
          color="error"
          variant="soft"
          icon="i-ph-warning-circle"
          :description="erreur"
        />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          class="min-h-(--cible-tactile) justify-center"
          :disabled="enCours"
          @click="ouvert = false"
        >
          Annuler
        </UButton>
        <UButton
          :color="definition.destructive ? 'error' : 'primary'"
          size="lg"
          class="min-h-(--cible-tactile) justify-center"
          :loading="enCours"
          :disabled="!valide"
          @click="confirmer"
        >
          {{ definition.confirmation }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
