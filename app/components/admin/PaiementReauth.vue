<script setup lang="ts">
import { ADMIN_MOTIF_MAX, ADMIN_REAUTH_CODE_FORMAT } from '#shared/admin'
import { MESSAGE_MOTIF, motifValide, nouvelleCleIdempotence } from '~/utils/admin-paiements'

// « Marquer comme payé », en ligne dans le tiroir : motif, puis code reçu par e-mail (réauthentification), puis envoi.
// Monté à la demande : la clé d'idempotence est générée à l'ouverture et conservée pour tous les essais, donc
// rejouer la demande ne prolonge jamais l'abonnement deux fois.
const CODE_LENGTH = 6

const props = defineProps<{
  enCours: boolean
  erreur: string
  demanderCode: () => Promise<boolean>
}>()
const emit = defineEmits<{
  confirmer: [donnees: { motif: string, cleIdempotence: string, code: string }]
  annuler: []
}>()

type Etape = 'motif' | 'code'

const etape = ref<Etape>('motif')
const motif = ref('')
const tente = ref(false)
const chiffres = ref<number[]>([])
const cleIdempotence = nouvelleCleIdempotence()

const code = computed(() => chiffres.value.join(''))
const codeComplet = computed(() => ADMIN_REAUTH_CODE_FORMAT.test(code.value))
const erreurMotif = computed(() => (tente.value && !motifValide(motif.value) ? MESSAGE_MOTIF : ''))

async function envoyerCode(): Promise<void> {
  tente.value = true
  if (props.enCours || !motifValide(motif.value)) return
  if (await props.demanderCode()) {
    chiffres.value = []
    etape.value = 'code'
  }
}

function confirmer(): void {
  if (props.enCours || !codeComplet.value) return
  emit('confirmer', { motif: motif.value, cleIdempotence, code: code.value })
}
</script>

<template>
  <form
    v-if="etape === 'motif'"
    class="flex flex-col gap-4"
    novalidate
    @submit.prevent="envoyerCode"
  >
    <p class="text-muted">
      L’abonnement sera prolongé d’une période et le paiement d’origine passera en anomalie. Un code de confirmation vous sera envoyé par e-mail.
    </p>
    <UFormField label="Motif" name="motif" :error="erreurMotif" required>
      <UTextarea v-model="motif" :rows="3" :maxlength="ADMIN_MOTIF_MAX" :disabled="enCours" autofocus class="w-full" />
    </UFormField>
    <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
    <div class="flex flex-wrap justify-end gap-3">
      <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile)" :disabled="enCours" @click="emit('annuler')">
        Annuler
      </UButton>
      <UButton type="submit" size="lg" class="min-h-(--cible-tactile)" :loading="enCours">
        Recevoir le code
      </UButton>
    </div>
  </form>

  <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="confirmer">
    <p class="text-muted">
      Saisissez le code à 6 chiffres envoyé à votre adresse. Il n’est valable que pour ce paiement.
    </p>
    <UPinInput
      v-model="chiffres"
      type="number"
      otp
      autofocus
      :length="CODE_LENGTH"
      :color="erreur ? 'error' : 'primary'"
      :highlight="Boolean(erreur)"
      :disabled="enCours"
    />
    <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
    <UButton
      color="neutral"
      variant="link"
      size="lg"
      class="-ml-3 min-h-(--cible-tactile) self-start font-medium underline underline-offset-4"
      :disabled="enCours"
      @click="envoyerCode"
    >
      Renvoyer le code
    </UButton>
    <div class="flex flex-wrap justify-end gap-3">
      <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile)" :disabled="enCours" @click="emit('annuler')">
        Annuler
      </UButton>
      <UButton type="submit" size="lg" class="min-h-(--cible-tactile)" :loading="enCours" :disabled="!codeComplet">
        Marquer comme payé
      </UButton>
    </div>
  </form>
</template>
