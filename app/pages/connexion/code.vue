<script setup lang="ts">
type Canal = 'email' | 'telephone'

interface IdentifiantMemorise {
  canal: Canal
  valeur: string
}

const authClient = useAuthClient()

const identifiant = ref<IdentifiantMemorise | null>(null)
const chiffres = ref<string[]>(['', '', '', '', '', ''])
const cases = ref<HTMLInputElement[]>([])
const chargement = ref(false)
const erreur = ref('')
const essaisEchoues = ref(0)
const secondes = ref(60)

let minuteur: ReturnType<typeof setInterval> | null = null

const codeComplet = computed(() => chiffres.value.every((c) => c !== ''))
const libelleIdentifiant = computed(() => {
  if (!identifiant.value) {
    return ''
  }
  return identifiant.value.canal === 'email' ? 'email' : 'numéro'
})

function demarrerDecompte(): void {
  secondes.value = 60
  minuteur = setInterval(() => {
    if (secondes.value > 0) {
      secondes.value -= 1
    } else if (minuteur) {
      clearInterval(minuteur)
      minuteur = null
    }
  }, 1_000)
}

function saisir(index: number, evenement: Event): void {
  const cible = evenement.target as HTMLInputElement
  const valeur = cible.value.replace(/\D/g, '')
  cible.value = valeur.slice(-1)
  chiffres.value[index] = cible.value
  if (cible.value && index < 5) {
    cases.value[index + 1]?.focus()
  }
}

function coller(index: number, evenement: ClipboardEvent): void {
  evenement.preventDefault()
  const texte = evenement.clipboardData?.getData('text').replace(/\D/g, '') ?? ''
  if (!texte) {
    return
  }
  for (let i = 0; i < 6; i += 1) {
    const chiffre = texte[i] ?? ''
    chiffres.value[i] = chiffre
    const caseCourante = cases.value[i]
    if (caseCourante) {
      caseCourante.value = chiffre
    }
  }
  const cible = Math.min(index + texte.length, 5)
  cases.value[cible]?.focus()
}

function retour(index: number, evenement: KeyboardEvent): void {
  if (evenement.key === 'Backspace' && !chiffres.value[index] && index > 0) {
    cases.value[index - 1]?.focus()
  }
}

function pointerCase(index: number, element: unknown): void {
  if (element instanceof HTMLInputElement) {
    cases.value[index] = element
  }
}

function messageEchec(): string {
  const restants = 3 - essaisEchoues.value
  if (restants > 0) {
    return `Ce code n'est pas correct. Il vous reste ${restants} essai${restants > 1 ? 's' : ''}.`
  }
  return "Votre code n'est plus valable. Demandez-en un nouveau."
}

async function verifier(): Promise<void> {
  if (!identifiant.value || !codeComplet.value) {
    return
  }
  erreur.value = ''
  chargement.value = true
  try {
    if (!authClient) {
      erreur.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
      return
    }
    const code = chiffres.value.join('')
    const reponse =
      identifiant.value.canal === 'email'
        ? await authClient.signIn.emailOtp({ email: identifiant.value.valeur, otp: code })
        : await authClient.phoneNumber.verify({ phoneNumber: identifiant.value.valeur, code })
    if (reponse.error) {
      essaisEchoues.value += 1
      erreur.value = messageEchec()
      return
    }
    sessionStorage.removeItem('brandself:identifiant')
    await navigateTo('/onboarding')
  } finally {
    chargement.value = false
  }
}

async function renvoyer(): Promise<void> {
  if (!identifiant.value || secondes.value > 0) {
    return
  }
  erreur.value = ''
  if (!authClient) {
    erreur.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
    return
  }
  const reponse =
    identifiant.value.canal === 'email'
      ? await authClient.emailOtp.sendVerificationOtp({
          email: identifiant.value.valeur,
          type: 'sign-in',
        })
      : await authClient.phoneNumber.sendOtp({ phoneNumber: identifiant.value.valeur })
  if (reponse.error) {
    erreur.value = reponse.error.message ?? "L'envoi a échoué. Réessayez dans un instant."
    return
  }
  essaisEchoues.value = 0
  demarrerDecompte()
}

onMounted(() => {
  const brut = sessionStorage.getItem('brandself:identifiant')
  if (!brut) {
    void navigateTo('/connexion')
    return
  }
  try {
    identifiant.value = JSON.parse(brut) as IdentifiantMemorise
  } catch {
    void navigateTo('/connexion')
    return
  }
  demarrerDecompte()
  cases.value[0]?.focus()
})

onUnmounted(() => {
  if (minuteur) {
    clearInterval(minuteur)
  }
})
</script>

<template>
  <main class="page-code">
    <h1>Votre code</h1>
    <p class="introduction">
      Nous avons envoyé un code à 6 chiffres à votre {{ libelleIdentifiant }}
      <strong v-if="identifiant">{{ identifiant.valeur }}</strong>. Il est valable 10 minutes.
    </p>

    <form class="cases" novalidate @submit.prevent="verifier">
      <input
        v-for="(_, i) in chiffres"
        :key="i"
        :ref="(el) => pointerCase(i, el)"
        :value="chiffres[i]"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="2"
        :aria-label="`Chiffre ${i + 1}`"
        :disabled="chargement"
        @input="saisir(i, $event)"
        @keydown="retour(i, $event)"
        @paste="coller(i, $event)"
      >
    </form>

    <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

    <button type="button" class="bouton bouton-principal" :disabled="chargement || !codeComplet" @click="verifier">
      {{ chargement ? 'Vérification…' : 'Me connecter' }}
    </button>

    <p class="renvoi">
      <button
        type="button"
        class="lien"
        :disabled="secondes > 0"
        @click="renvoyer"
      >
        {{ secondes > 0 ? `Renvoyer le code (${secondes} s)` : 'Renvoyer le code' }}
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
