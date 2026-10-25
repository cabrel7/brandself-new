<script setup lang="ts">
type Channel = 'email' | 'telephone'

interface StoredIdentifier {
  channel: Channel
  value: string
}

const authClient = useAuthClient()
const googleActif = useRuntimeConfig().public.googleActif

const channel = ref<Channel>('email')
const email = ref('')
const countryCode = ref('+237')
const number = ref('')
const loading = ref(false)
const error = ref('')

const countryCodes = [
  { code: '+237', country: 'Cameroun' },
  { code: '+229', country: 'Bénin' },
  { code: '+225', country: "Côte d'Ivoire" },
  { code: '+221', country: 'Sénégal' },
  { code: '+241', country: 'Gabon' },
  { code: '+243', country: 'RD Congo' },
  { code: '+226', country: 'Burkina Faso' },
  { code: '+223', country: 'Mali' },
  { code: '+228', country: 'Togo' },
  { code: '+33', country: 'France' },
  { code: '+32', country: 'Belgique' },
  { code: '+41', country: 'Suisse' },
  { code: '+1', country: 'Canada / États-Unis' },
]

function storeIdentifier(c: Channel, value: string): void {
  const storedIdentifier: StoredIdentifier = { channel: c, value }
  sessionStorage.setItem('brandself:identifiant', JSON.stringify(storedIdentifier))
}

function normalizePhone(): string {
  const digits = number.value.replace(/\D/g, '')
  if (!digits) {
    return ''
  }
  return `${countryCode.value}${digits}`
}

function translateError(message: string): string {
  if (/too many|rate limit/i.test(message)) {
    return 'Trop de tentatives. Patientez une minute avant de recommencer.'
  }
  if (/otp.*send|send.*otp/i.test(message)) {
    return "L'envoi du code a échoué. Réessayez dans un instant."
  }
  return message
}

async function sendCode(): Promise<void> {
  error.value = ''
  loading.value = true
  try {
    if (!authClient) {
      error.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
      return
    }
    if (channel.value === 'email') {
      const value = email.value.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        error.value = 'Entrez une adresse email valide.'
        return
      }
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
        email: value,
        type: 'sign-in',
      })
      if (sendError) {
        error.value = translateError(sendError.message ?? 'Erreur inconnue')
        return
      }
      storeIdentifier('email', value)
    } else {
      const phone = normalizePhone()
      if (phone.replace(/\D/g, '').length < 6) {
        error.value = 'Entrez un numéro de téléphone valide.'
        return
      }
      const { error: sendError } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone })
      if (sendError) {
        error.value = translateError(sendError.message ?? 'Erreur inconnue')
        return
      }
      storeIdentifier('telephone', phone)
    }
    await navigateTo('/connexion/code')
  } finally {
    loading.value = false
  }
}

async function continueWithGoogle(): Promise<void> {
  error.value = ''
  if (!authClient) {
    error.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
    return
  }
  await authClient.signIn.social({ provider: 'google', callbackURL: '/onboarding' })
}
</script>

<template>
  <div class="connexion">
    <section class="panneau" aria-hidden="true">
      <p class="panneau-titre">Bienvenue.</p>
      <p class="panneau-texte">Construisons votre vitrine ensemble.</p>
    </section>

    <main class="formulaire">
      <h1>Connexion</h1>
      <p class="introduction">Recevez un code à 6 chiffres par email ou par SMS. Aucun mot de passe à gérer.</p>

      <button
        type="button"
        class="bouton bouton-google"
        :disabled="!googleActif"
        @click="continueWithGoogle"
      >
        Continuer avec Google
      </button>
      <p v-if="!googleActif" class="note-google">
        Connexion Google bientôt disponible. Utilisez votre email ou votre téléphone pour l'instant.
      </p>

      <div class="separateur" role="separator">ou</div>

      <div class="onglets" role="tablist">
        <button
          type="button"
          role="tab"
        :aria-selected="channel === 'email'"
        :class="{ actif: channel === 'email' }"
        @click="channel = 'email'"
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
        :aria-selected="channel === 'telephone'"
        :class="{ actif: channel === 'telephone' }"
        @click="channel = 'telephone'"
        >
          Téléphone
        </button>
      </div>

      <form novalidate @submit.prevent="sendCode">
        <div v-if="channel === 'email'" class="champ">
          <label for="email">Adresse email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            inputmode="email"
            placeholder="vous@exemple.com"
          >
        </div>

        <div v-else class="champ">
          <label for="country-code">Indicatif</label>
          <select id="country-code" v-model="countryCode">
            <option v-for="c in countryCodes" :key="c.code" :value="c.code">
              {{ c.code }} — {{ c.country }}
            </option>
          </select>
          <label for="phone-number">Numéro de téléphone</label>
          <input
            id="phone-number"
            v-model="number"
            type="tel"
            name="tel"
            autocomplete="tel-national"
            inputmode="tel"
            placeholder="6 90 00 00 00"
          >
        </div>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button type="submit" class="bouton bouton-principal" :disabled="loading">
          {{ loading ? 'Envoi en cours…' : 'Recevoir mon code' }}
        </button>
      </form>

      <p class="mentions">
        En continuant, vous acceptez nos conditions d'utilisation et notre
        politique de confidentialité.
      </p>
    </main>
  </div>
</template>

<style scoped>
.connexion {
  min-height: 100vh;
  display: grid;
}

.panneau {
  display: none;
}

.formulaire {
  max-width: 26rem;
  width: 100%;
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

.bouton {
  min-height: 3rem;
  border-radius: 0.75rem;
  border: 1px solid var(--bordure);
  background-color: var(--surface);
  color: var(--encre);
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

.note-google {
  font-size: 0.8rem;
  color: var(--texte-secondaire);
  margin-top: -0.5rem;
}

.separateur {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--texte-secondaire);
  font-size: 0.85rem;
}

.separateur::before,
.separateur::after {
  content: "";
  flex: 1;
  height: 1px;
  background-color: var(--bordure);
}

.onglets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--bordure);
  border-radius: 0.75rem;
  overflow: hidden;
}

.onglets button {
  min-height: 2.75rem;
  border: none;
  background: none;
  font-family: var(--font-texte);
  font-size: 0.95rem;
  cursor: pointer;
}

.onglets button.actif {
  background-color: var(--accent-doux);
  font-weight: 600;
}

.champ {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.champ label {
  font-size: 0.85rem;
  color: var(--texte-secondaire);
}

.champ input,
.champ select {
  min-height: 2.75rem;
  border: 1px solid var(--bordure);
  border-radius: 0.75rem;
  background-color: #FFFFFF;
  padding: 0 0.75rem;
  font-size: 1rem;
}

.erreur {
  color: var(--erreur);
  font-size: 0.9rem;
}

.mentions {
  font-size: 0.8rem;
  color: var(--texte-secondaire);
  line-height: 1.5;
}

@media (min-width: 64rem) {
  .connexion {
    grid-template-columns: 1fr 1fr;
    align-items: stretch;
  }

  .panneau {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 3rem;
    background-color: var(--surface);
  }

  .panneau-titre {
    font-family: var(--font-titre);
    font-size: 2.75rem;
    font-weight: 600;
    line-height: 1.15;
  }

  .panneau-texte {
    margin-top: 0.75rem;
    color: var(--texte-secondaire);
    font-size: 1.1rem;
  }

  .formulaire {
    justify-content: center;
    padding-top: 3rem;
  }
}
</style>
