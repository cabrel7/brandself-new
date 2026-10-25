<script setup lang="ts">
type Channel = 'email' | 'telephone'

interface StoredIdentifier {
  channel: Channel
  value: string
}

const authClient = useAuthClient()

const storedIdentifier = ref<StoredIdentifier | null>(null)
const digits = ref<string[]>(['', '', '', '', '', ''])
const cases = ref<HTMLInputElement[]>([])
const loading = ref(false)
const error = ref('')
const failedAttempts = ref(0)
const seconds = ref(60)

let timer: ReturnType<typeof setInterval> | null = null

const codeComplete = computed(() => digits.value.every((d) => d !== ''))
const identifierLabel = computed(() => {
  if (!storedIdentifier.value) {
    return ''
  }
  return storedIdentifier.value.channel === 'email' ? 'email' : 'numéro'
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

function enterDigit(index: number, event: Event): void {
  const target = event.target as HTMLInputElement
  const value = target.value.replace(/\D/g, '')
  target.value = value.slice(-1)
  digits.value[index] = target.value
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

function failureMessage(): string {
  const remaining = 3 - failedAttempts.value
  if (remaining > 0) {
    return `Ce code n'est pas correct. Il vous reste ${remaining} essai${remaining > 1 ? 's' : ''}.`
  }
  return "Votre code n'est plus valable. Demandez-en un nouveau."
}

async function verify(): Promise<void> {
  if (!storedIdentifier.value || !codeComplete.value) {
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
      return
    }
    sessionStorage.removeItem('brandself:identifiant')
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
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<template>
  <main class="page-code">
    <h1>Votre code</h1>
    <p class="introduction">
      Nous avons envoyé un code à 6 chiffres à votre {{ identifierLabel }}
      <strong v-if="storedIdentifier">{{ storedIdentifier.value }}</strong>. Il est valable 10 minutes.
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
        maxlength="2"
        :aria-label="`Chiffre ${i + 1}`"
        :disabled="loading"
        @input="enterDigit(i, $event)"
        @keydown="goBack(i, $event)"
        @paste="paste(i, $event)"
      >
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <button type="button" class="bouton bouton-principal" :disabled="loading || !codeComplete" @click="verify">
      {{ loading ? 'Vérification…' : 'Me connecter' }}
    </button>

    <p class="renvoi">
      <button
        type="button"
        class="lien"
        :disabled="seconds > 0"
        @click="resend"
      >
        {{ seconds > 0 ? `Renvoyer le code (${seconds} s)` : 'Renvoyer le code' }}
      </button>
    </p>

    <NuxtLink class="lien modifier" to="/connexion">
      Modifier mon email / mon numéro
    </NuxtLink>
  </main>
</template>

<style scoped>
.page-code {
  max-width: 26rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1 {
  font-size: 2rem;
  font-weight: 600;
}

.introduction {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  line-height: 1.5;
}

.cases {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.4rem;
}

.cases input {
  min-height: 3.25rem;
  text-align: center;
  font-size: 1.4rem;
  border: 1px solid var(--bordure);
  border-radius: 0.75rem;
  background-color: #FFFFFF;
}

.bouton {
  min-height: 3rem;
  border-radius: 0.75rem;
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
  color: #FFFFFF;
}

.erreur {
  color: var(--erreur);
  font-size: 0.9rem;
}

.lien {
  background: none;
  border: none;
  color: var(--accent);
  font-family: var(--font-texte);
  font-size: 0.95rem;
  text-decoration: underline;
  cursor: pointer;
  min-height: 2.75rem;
}

.lien:disabled {
  color: var(--texte-secondaire);
  cursor: not-allowed;
}

.modifier {
  align-self: flex-start;
  color: var(--texte-secondaire);
}
</style>
