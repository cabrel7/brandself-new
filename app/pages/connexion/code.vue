<script setup lang="ts">
type Channel = 'email' | 'telephone'

interface StoredIdentifier {
  channel: Channel
  value: string
}

const authClient = useAuthClient()
const devMode = useRuntimeConfig().public.boiteOtpDev === true

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

function enterDigit(index: number, event: Event): void {
  const target = event.target as HTMLInputElement
  const value = target.value.replace(/\D/g, '')
  target.value = value.slice(-1)
  digits.value[index] = target.value
  erreurVisible.value = false
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
  error.value = ''
  loading.value = true
  try {
    if (!authClient) {
      error.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
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
  } finally {
    loading.value = false
  }
}

async function resend(): Promise<void> {
  if (!storedIdentifier.value || seconds.value > 0) {
    return
  }
  error.value = ''
  erreurVisible.value = false
  if (!authClient) {
    error.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
    return
  }
  const response =
    storedIdentifier.value.channel === 'email'
      ? await authClient.emailOtp.sendVerificationOtp({
          email: storedIdentifier.value.value,
          type: 'sign-in',
        })
      : await authClient.phoneNumber.sendOtp({ phoneNumber: storedIdentifier.value.value })
  if (response.error) {
    error.value = response.error.message ?? "L'envoi a échoué. Réessayez dans un instant."
    return
  }
  failedAttempts.value = 0
  startCountdown()
  lancerLectureBoite()
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
  <main class="page-code">
    <NuxtLink class="retour" to="/connexion">
      <PhosphorIcon name="arrow-left" size="1rem" aria-hidden="true" />
      <span>{{ lienRetour }}</span>
    </NuxtLink>

    <h1>Saisissez votre code</h1>
    <p class="introduction">
      Nous avons envoyé un code à 6 chiffres à <strong>{{ identifiantAffiche }}</strong>.
    </p>

    <form class="cases" novalidate @submit.prevent="verify">
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
        :class="{ 'saisie-erreur': erreurVisible }"
        :disabled="loading"
        @input="enterDigit(i, $event)"
        @keydown="goBack(i, $event)"
        @paste="paste(i, $event)"
      >
    </form>

    <p class="expiration">Le code expire dans 10 minutes.</p>

    <p v-if="error" class="erreur" role="alert">
      <PhosphorIcon name="warning-circle" size="1.15rem" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <div v-if="boiteVisible" class="boite-dev">
      <p class="boite-dev__titre">Mode développement — aucun fournisseur configuré</p>
      <p v-if="boiteCode" class="boite-dev__code">
        Code : <strong>{{ boiteCode }}</strong>
      </p>
      <p v-else-if="boiteManquant" class="boite-dev__vide">
        Aucun code reçu. Le worker est-il lancé&nbsp;? Lancez <code>pnpm dev</code> (app + worker).
      </p>
      <p v-else class="boite-dev__attente">Envoi en cours…</p>
    </div>

    <button
      type="button"
      class="bouton bouton-principal"
      :disabled="loading"
      @click="verify"
    >
      {{ loading ? 'Vérification…' : 'Valider' }}
    </button>

    <div class="pied">
      <button
        v-if="seconds > 0"
        type="button"
        class="texte"
        disabled
      >
        Renvoyer le code dans {{ compteARebours }}
      </button>
      <button v-else type="button" class="texte lien" @click="resend">Renvoyer le code</button>
      <p class="texte">{{ aideIndesirables }}</p>
    </div>
  </main>
</template>

<style scoped>
.page-code {
  max-width: 30rem;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.retour {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  color: var(--accent);
  font-size: 1rem;
  text-decoration: none;
  min-height: 2.75rem;
}

.retour:hover {
  text-decoration: underline;
}

h1 {
  font-size: clamp(2.25rem, 8vw, 2.75rem);
  font-weight: 600;
  line-height: 1.1;
  margin: 0;
}

.introduction {
  color: var(--texte-secondaire);
  font-size: 1.05rem;
  line-height: 1.5;
  margin: 0;
}

.introduction strong {
  color: var(--encre);
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
  font-size: 1.75rem;
  color: var(--encre);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  background-color: var(--champ);
}

.cases input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 1px var(--accent);
}

.cases input.saisie-erreur {
  border-color: var(--accent);
}

.expiration {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  margin: 0;
}

.erreur {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--erreur);
  font-size: 1rem;
  font-weight: 500;
  margin: 0;
}

.boite-dev {
  border: 1px dashed var(--accent);
  border-radius: 1rem;
  background-color: var(--accent-doux);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.boite-dev__titre {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--texte-secondaire);
  margin: 0;
}

.boite-dev__code,
.boite-dev__vide,
.boite-dev__attente {
  font-size: 0.95rem;
  color: var(--encre);
  margin: 0;
}

.boite-dev__code strong {
  font-family: var(--font-titre);
  font-size: 1.35rem;
  letter-spacing: 0.15em;
}

.boite-dev code {
  background-color: var(--champ);
  border: 1px solid var(--bordure);
  border-radius: 0.35rem;
  padding: 0 0.3rem;
  font-size: 0.85rem;
}

.bouton {
  min-height: 3.5rem;
  border-radius: 1rem;
  border: 1px solid var(--bordure);
  font-family: var(--font-texte);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

.bouton:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.bouton-principal {
  background-color: var(--accent);
  border-color: var(--accent);
  color: var(--champ);
}

.pied {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.texte {
  background: none;
  border: none;
  padding: 0;
  color: var(--texte-secondaire);
  font-family: var(--font-texte);
  font-size: 0.95rem;
  line-height: 1.5;
  text-align: left;
  min-height: auto;
}

button.texte:disabled {
  cursor: default;
}

.lien {
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  min-height: 2.75rem;
  align-self: flex-start;
}
</style>
