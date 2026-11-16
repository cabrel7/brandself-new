<script setup lang="ts">
import { ADMIN_MOTIF_MAX, ADMIN_REAUTH_CODE_FORMAT } from '#shared/admin'
import type { AdminAction, AdminCible } from '#shared/admin'
import { MESSAGE_MOTIF, motifValide } from '~/utils/admin-paiements'

// Motif obligatoire puis code de réauthentification reçu par e-mail : commun aux écritures des versions et des
// catalogues (A5). Le parent garde le bouton d'envoi, l'erreur du serveur et la clé d'idempotence ; ce bloc ne fait que
// recueillir les deux saisies. Il est monté à l'ouverture du panneau : chaque ouverture repart de zéro.
const CODE_LENGTH = 6

const props = defineProps<{
  action: AdminAction
  cibleType: AdminCible
  cibleId: string
  enCours: boolean
  /** Texte d'introduction de l'étape (ce qui va être enregistré). */
  consigne?: string
  /** Longueur maximale du motif si elle est plus courte que celle du journal (nom bloqué : 200). */
  motifMax?: number
  /** Un brouillon ne change rien au produit : motif seulement, pas de code. */
  sansCode?: boolean
}>()
const motif = defineModel<string>('motif', { required: true })
const code = defineModel<string>('code', { default: '' })

const reauth = useReauthCode()
const chiffres = ref<number[]>([])
const motifTouche = ref(false)

const longueurMax = computed(() => props.motifMax ?? ADMIN_MOTIF_MAX)
const motifRestant = computed(() => longueurMax.value - motif.value.length)
const erreurMotif = computed(() => (motifTouche.value && !motifValide(motif.value) ? MESSAGE_MOTIF : ''))

watch(chiffres, (valeur) => {
  const saisi = valeur.join('')
  code.value = ADMIN_REAUTH_CODE_FORMAT.test(saisi) ? saisi : ''
})
// Le parent vide le code après un échec (un code est à usage unique) : le champ le suit.
watch(code, (valeur) => {
  if (valeur === '' && ADMIN_REAUTH_CODE_FORMAT.test(chiffres.value.join(''))) chiffres.value = []
})

async function demanderCode(): Promise<void> {
  chiffres.value = []
  code.value = ''
  await reauth.demander(props.action, props.cibleType, props.cibleId)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <p v-if="consigne" class="m-0 text-base text-texte-secondaire">
      {{ consigne }}
    </p>

    <UFormField label="Motif" name="motif" required :error="erreurMotif">
      <UTextarea
        v-model="motif"
        :rows="3"
        :maxlength="longueurMax"
        class="w-full"
        :disabled="enCours"
        @blur="motifTouche = true"
      />
      <template #hint>
        <span class="text-(length:--fs-14) text-texte-secondaire" aria-live="polite">{{ motifRestant }} caractères restants</span>
      </template>
    </UFormField>

    <div v-if="!sansCode" class="flex flex-col gap-3">
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
  </div>
</template>
