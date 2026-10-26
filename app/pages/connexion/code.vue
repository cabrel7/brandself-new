<script setup lang="ts">
type Channel = 'email' | 'telephone'

interface StoredIdentifier {
  channel: Channel
  value: string
}

const authClient = useAuthClient()
// Boîte OTP de développement : jamais en production (drapeau + build de dev).
const devMode = import.meta.dev && useRuntimeConfig().public.boiteOtpDev === true

const storedIdentifier = ref<StoredIdentifier | null>(null)
const CODE_LENGTH = 6

// Un chiffre par case (UPinInput en mode numérique) ; une case vidée n'est plus un nombre.
const digits = ref<number[]>([])
const pin = useTemplateRef('pin')
const loading = ref(false)
const error = ref('')
const erreurVisible = ref(false)
const failedAttempts = ref(0)
const seconds = ref(60)
const boiteCode = ref('')
const boiteManquant = ref(false)
const boiteVisible = ref(false)
const resending = ref(false)

const ERREUR_PAGE = 'La page a rencontré un problème. Rechargez-la et réessayez.'
const ERREUR_ENVOI = "Nous n'avons pas pu envoyer le code. Réessayez dans un instant."
const ERREUR_VERIF = "Nous n'avons pas pu vérifier le code. Réessayez dans un instant."

let timer: ReturnType<typeof setInterval> | null = null
let boiteTimer: ReturnType<typeof setInterval> | null = null
let boiteTentatives = 0

const codeComplete = computed(() =>
  Array.from({ length: CODE_LENGTH }, (_, i) => digits.value[i]).every((d) => typeof d === 'number'),
)

const identifiantAffiche = computed(() => storedIdentifier.value?.value ?? '')

const lienRetour = computed(() =>
  storedIdentifier.value?.channel === 'telephone' ? 'Modifier le numéro' : "Modifier l'email",
)

const aideIndesirables = computed(() =>
  storedIdentifier.value?.channel === 'telephone'
    ? 'Rien reçu ? Vérifiez vos messages indésirables.'
    : 'Rien reçu ? Vérifiez vos courriels indésirables.',
)

const compteARebours = computed(() => {
  const minutes = Math.floor(seconds.value / 60)
  const reste = seconds.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(reste).padStart(2, '0')}`
})

function startCountdown(): void {
  seconds.value = 60
  timer = setInterval(() => {
    if (seconds.value > 0) {
      seconds.value -= 1
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1_000)
}

function stopBoite(): void {
  if (boiteTimer) {
    clearInterval(boiteTimer)
    boiteTimer = null
  }
}

// Aucun fournisseur n'est configuré en développement : le code atterrit dans la
// boîte OTP (Redis) lue par /api/dev/boite-otp, en attendant le branchement de
// Resend ou d'une passerelle SMS.
function lancerLectureBoite(): void {
  if (!devMode || !storedIdentifier.value) {
    return
  }
  stopBoite()
  boiteCode.value = ''
  boiteManquant.value = false
  boiteTentatives = 0
  boiteTimer = setInterval(() => {
    boiteTentatives += 1
    void $fetch<{ code: string | null }>(`/api/dev/boite-otp?identifiant=${encodeURIComponent(storedIdentifier.value?.value ?? '')}`)
      .then((reponse) => {
        if (reponse.code) {
          boiteCode.value = reponse.code
          stopBoite()
        } else if (boiteTentatives >= 20) {
          boiteManquant.value = true
          stopBoite()
        }
      })
      .catch(() => {
        if (boiteTentatives >= 20) {
          boiteManquant.value = true
          stopBoite()
        }
      })
    if (boiteTentatives === 1) {
      boiteVisible.value = true
    }
  }, 1_000)
}

function clearError(): void {
  error.value = ''
  erreurVisible.value = false
}

function focusCaseVide(): void {
  const index = Array.from({ length: CODE_LENGTH }, (_, i) => digits.value[i]).findIndex(
    (d) => typeof d !== 'number',
  )
  pin.value?.inputsRef[index === -1 ? 0 : index]?.$el.focus()
}

function failureMessage(): string {
  const remaining = 3 - failedAttempts.value
  if (remaining > 0) {
    return `Ce code n'est pas correct. Il vous reste ${remaining} essai${remaining > 1 ? 's' : ''}.`
  }
  return "Votre code n'est plus valable. Demandez-en un nouveau."
}

async function verify(): Promise<void> {
  if (!storedIdentifier.value) {
    return
  }
  if (!codeComplete.value) {
    focusCaseVide()
    return
  }
  clearError()
  loading.value = true
  try {
    if (!authClient) {
      error.value = ERREUR_PAGE
      return
    }
    const code = digits.value.join('')
    const response =
      storedIdentifier.value.channel === 'email'
        ? await authClient.signIn.emailOtp({ email: storedIdentifier.value.value, otp: code })
        : await authClient.phoneNumber.verify({ phoneNumber: storedIdentifier.value.value, code })
    if (response.error) {
      failedAttempts.value += 1
      error.value = failureMessage()
      erreurVisible.value = true
      return
    }
    sessionStorage.removeItem('brandself:identifiant')
    stopBoite()
    await navigateTo('/onboarding')
  } catch {
    error.value = ERREUR_VERIF
  } finally {
    loading.value = false
  }
}

async function resend(): Promise<void> {
  if (!storedIdentifier.value || seconds.value > 0 || resending.value) {
    return
  }
  clearError()
  if (!authClient) {
    error.value = ERREUR_PAGE
    return
  }
  resending.value = true
  try {
    const response =
      storedIdentifier.value.channel === 'email'
        ? await authClient.emailOtp.sendVerificationOtp({
            email: storedIdentifier.value.value,
            type: 'sign-in',
          })
        : await authClient.phoneNumber.sendOtp({ phoneNumber: storedIdentifier.value.value })
    if (response.error) {
      error.value = ERREUR_ENVOI
      return
    }
    failedAttempts.value = 0
    startCountdown()
    lancerLectureBoite()
  } catch {
    error.value = ERREUR_ENVOI
  } finally {
    resending.value = false
  }
}

onMounted(() => {
  const raw = sessionStorage.getItem('brandself:identifiant')
  if (!raw) {
    void navigateTo('/connexion')
    return
  }
  try {
    storedIdentifier.value = JSON.parse(raw) as StoredIdentifier
  } catch {
    void navigateTo('/connexion')
    return
  }
  startCountdown()
  lancerLectureBoite()
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
  stopBoite()
})
</script>

<template>
  <main class="mx-auto flex w-full max-w-120 flex-col gap-4 px-6 pt-8 pb-12">
    <UButton
      to="/connexion"
      color="neutral"
      variant="link"
      size="lg"
      icon="i-ph-arrow-left"
      class="-ml-3 self-start font-normal"
    >
      {{ lienRetour }}
    </UButton>

    <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">
      Saisissez votre code
    </h1>
    <p class="text-muted">
      Nous avons envoyé un code à 6 chiffres à
      <strong class="font-semibold text-default">{{ identifiantAffiche }}</strong>.
    </p>

    <form novalidate @submit.prevent="verify">
      <UPinInput
        ref="pin"
        v-model="digits"
        class="cases"
        type="number"
        otp
        autofocus
        :length="CODE_LENGTH"
        :color="erreurVisible ? 'error' : 'primary'"
        :highlight="erreurVisible"
        :disabled="loading"
        @update:model-value="clearError"
      />
    </form>

    <UAlert
      v-if="error"
      id="erreur-code"
      role="alert"
      color="error"
      variant="soft"
      icon="i-ph-warning-circle"
      :description="error"
    />
    <p v-else class="text-sm text-muted">Le code expire dans 10 minutes.</p>

    <UButton block :loading="loading" @click="verify">
      {{ loading ? 'Vérification…' : 'Valider' }}
    </UButton>

    <div class="flex flex-col">
      <p v-if="seconds > 0" class="flex min-h-(--cible-tactile) items-center text-muted">
        Renvoyer le code dans {{ compteARebours }}
      </p>
      <UButton
        v-else
        variant="link"
        size="lg"
        class="-ml-3 self-start font-medium underline underline-offset-4"
        :loading="resending"
        @click="resend"
      >
        Renvoyer le code
      </UButton>
      <p class="flex min-h-(--cible-tactile) items-center text-muted">{{ aideIndesirables }}</p>
      <template v-if="devMode && boiteVisible">
        <p v-if="boiteCode" class="font-mono text-xs text-muted">Code de test : {{ boiteCode }}</p>
        <p v-else-if="boiteManquant" class="font-mono text-xs text-muted">
          Aucun code reçu : le worker est-il lancé ? (pnpm dev)
        </p>
        <p v-else class="font-mono text-xs text-muted">Code de test : en attente…</p>
      </template>
    </div>
  </main>
</template>
