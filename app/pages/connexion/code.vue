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
const digits = ref<string[]>(['', '', '', '', '', ''])
const cases = ref<HTMLInputElement[]>([])
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

const codeComplete = computed(() => digits.value.every((d) => d !== ''))

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

function enterDigit(index: number, event: Event): void {
  const target = event.target as HTMLInputElement
  const value = target.value.replace(/\D/g, '')
  target.value = value.slice(-1)
  digits.value[index] = target.value
  clearError()
  if (target.value && index < 5) {
    cases.value[index + 1]?.focus()
  }
}

function paste(index: number, event: ClipboardEvent): void {
  event.preventDefault()
  const text = event.clipboardData?.getData('text').replace(/\D/g, '') ?? ''
  if (!text) {
    return
  }
  clearError()
  for (let i = 0; i < 6; i += 1) {
    const digit = text[i] ?? ''
    digits.value[i] = digit
    const currentCase = cases.value[i]
    if (currentCase) {
      currentCase.value = digit
    }
  }
  const target = Math.min(index + text.length, 5)
  cases.value[target]?.focus()
}

function goBack(index: number, event: KeyboardEvent): void {
  if (event.key === 'Backspace' && !digits.value[index] && index > 0) {
    cases.value[index - 1]?.focus()
  }
}

function pointCase(index: number, element: unknown): void {
  if (element instanceof HTMLInputElement) {
    cases.value[index] = element
  }
}

function focusCaseVide(): void {
  const index = digits.value.findIndex((d) => d === '')
  cases.value[index === -1 ? 0 : index]?.focus()
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
  cases.value[0]?.focus()
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
  <main class="colonne-auth">
    <NuxtLink class="retour" to="/connexion">
      <PhosphorIcon name="arrow-left" size="1rem" aria-hidden="true" />
      <span>{{ lienRetour }}</span>
    </NuxtLink>

    <h1 class="titre-auth">Saisissez votre code</h1>
    <p class="texte-intro">
      Nous avons envoyé un code à 6 chiffres à <strong class="identifiant">{{ identifiantAffiche }}</strong>.
    </p>

    <form class="cases" role="group" aria-label="Code à 6 chiffres" novalidate @submit.prevent="verify">
      <input
        v-for="(_, i) in digits"
        :key="i"
        :ref="(el) => pointCase(i, el)"
        :value="digits[i]"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="1"
        :aria-label="`Chiffre ${i + 1}`"
        :aria-invalid="erreurVisible"
        :aria-describedby="erreurVisible ? 'erreur-code' : undefined"
        :class="{ 'saisie-erreur': erreurVisible }"
        :readonly="loading"
        @input="enterDigit(i, $event)"
        @keydown="goBack(i, $event)"
        @paste="paste(i, $event)"
      >
    </form>

    <p v-if="error" id="erreur-code" class="message-erreur" role="alert">
      <PhosphorIcon name="warning-circle" size="1.25rem" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
    <p v-else class="note expiration">Le code expire dans 10 minutes.</p>

    <BsButton block :loading="loading" @click="verify">
      {{ loading ? 'Vérification…' : 'Valider' }}
    </BsButton>

    <div class="pied">
      <p v-if="seconds > 0" class="ligne-pied">Renvoyer le code dans {{ compteARebours }}</p>
      <BsButton v-else variant="lien" class="renvoi" :loading="resending" @click="resend">
        Renvoyer le code
      </BsButton>
      <p class="ligne-pied">{{ aideIndesirables }}</p>
      <template v-if="devMode && boiteVisible">
        <p v-if="boiteCode" class="code-dev">Code de test : {{ boiteCode }}</p>
        <p v-else-if="boiteManquant" class="code-dev">
          Aucun code reçu : le worker est-il lancé ? (pnpm dev)
        </p>
        <p v-else class="code-dev">Code de test : en attente…</p>
      </template>
    </div>
  </main>
</template>

<style scoped>
.retour {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  align-self: flex-start;
  min-height: var(--cible-tactile);
  color: var(--texte-secondaire);
  font-size: var(--fs-16);
  text-decoration: none;
  transition: color var(--transition);
}

.retour:hover {
  color: var(--encre);
  text-decoration: underline;
}

.identifiant {
  color: var(--encre);
  font-weight: 600;
}

.cases {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.5rem;
}

.cases input {
  min-height: 4rem;
  min-width: 0;
  text-align: center;
  font-family: var(--font-titre);
  font-size: var(--fs-24);
  font-weight: 700;
  color: var(--encre);
  border: 1px solid var(--bordure);
  border-radius: var(--rayon);
  background-color: var(--champ);
  transition: border-color var(--transition);
}

.cases input:hover {
  border-color: var(--texte-secondaire);
}

.cases input.saisie-erreur {
  border-color: var(--erreur);
}

/* Focus : bordure + anneau = 2 px, visible même sur une case en erreur. */
.cases input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 1px var(--accent);
}

.pied {
  display: flex;
  flex-direction: column;
}

.ligne-pied {
  display: flex;
  align-items: center;
  min-height: var(--cible-tactile);
  margin: 0;
  color: var(--texte-secondaire);
  font-size: var(--fs-16);
}

.renvoi {
  align-self: flex-start;
  padding-left: 0;
  text-decoration: underline;
}

.code-dev {
  margin: 0;
  color: var(--texte-secondaire);
  font-family: ui-monospace, monospace;
  font-size: var(--fs-12);
}
</style>
