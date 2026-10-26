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

// WhatsApp : fournisseur non branché (décision ouverte, PROJECT_STATE.md §3).
// Le choix reste visible mais inactif tant que la passerelle n'existe pas.
const whatsappActif = false

const aideEnvoi = computed(() => {
  if (channel.value === 'email') {
    return 'Nous vous envoyons un code à 6 chiffres, valable 10 minutes.'
  }
  const canal = whatsappActif ? 'par SMS ou WhatsApp' : 'par SMS'
  return `Nous vous envoyons un code à 6 chiffres ${canal}, valable 10 minutes.`
})

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
    <aside class="panneau">
      <p class="panneau-marque">Brandself</p>
      <p class="panneau-titre">Votre vitrine professionnelle, prête en quelques minutes.</p>
      <ul class="panneau-points">
        <li>
          <PhosphorIcon name="check" weight="bold" size="1.15rem" aria-hidden="true" />
          <span>Une adresse simple à partager</span>
        </li>
        <li>
          <PhosphorIcon name="check" weight="bold" size="1.15rem" aria-hidden="true" />
          <span>Des rendez-vous réservables en ligne</span>
        </li>
        <li>
          <PhosphorIcon name="check" weight="bold" size="1.15rem" aria-hidden="true" />
          <span>Aucun mot de passe à retenir</span>
        </li>
      </ul>
      <p class="panneau-bas">Créé avec soin à Douala</p>
    </aside>

    <main class="formulaire">
      <p class="marque">Brandself</p>

      <h1>Bienvenue</h1>
      <p class="introduction">
        Connectez-vous ou créez votre vitrine en quelques instants. Aucun mot de passe à retenir.
      </p>

      <button
        type="button"
        class="bouton bouton-google"
        :disabled="!googleActif"
        @click="continueWithGoogle"
      >
        <span class="bouton-google__marque" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="20" height="20" focusable="false">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        </span>
        Continuer avec Google
      </button>
      <p v-if="!googleActif" class="note-google">
        Connexion Google bientôt disponible. Utilisez votre email ou votre téléphone pour l'instant.
      </p>

      <div class="separateur" role="separator">ou</div>

      <div class="onglets" role="tablist" aria-label="Canal de connexion">
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
          <label for="email">
            Adresse email
            <span class="obligatoire" aria-hidden="true">*</span>
          </label>
          <input
            id="email"
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            inputmode="email"
            placeholder="adresse@exemple.com"
            aria-required="true"
            required
          >
        </div>

        <div v-else class="champ-duo">
          <div class="champ">
            <label for="country-code">Indicatif</label>
            <select id="country-code" v-model="countryCode">
              <option v-for="c in countryCodes" :key="c.code" :value="c.code">
                {{ c.code }} — {{ c.country }}
              </option>
            </select>
          </div>
          <div class="champ champ-numero">
            <label for="phone-number">
              Numéro de téléphone
              <span class="obligatoire" aria-hidden="true">*</span>
            </label>
            <input
              id="phone-number"
              v-model="number"
              type="tel"
              name="tel"
              autocomplete="tel-national"
              inputmode="tel"
              placeholder="6 12 34 56 78"
              aria-required="true"
              required
            >
          </div>
        </div>

        <div v-if="channel === 'telephone'" class="bloc-canal">
          <p id="canal-label" class="legende">Recevoir le code par</p>
          <div class="onglets onglets--canal" role="group" aria-labelledby="canal-label">
            <button type="button" class="actif" aria-pressed="true">SMS</button>
            <button type="button" disabled aria-disabled="true">WhatsApp</button>
          </div>
          <p v-if="!whatsappActif" class="note-canal">
            L'envoi par WhatsApp arrivera avec la mise en service du fournisseur SMS.
          </p>
        </div>

        <p v-if="error" class="erreur" role="alert">{{ error }}</p>

        <button type="submit" class="bouton bouton-principal" :disabled="loading">
          {{ loading ? 'Envoi en cours…' : 'Recevoir un code' }}
        </button>

        <p class="aide">{{ aideEnvoi }}</p>

        <p class="mentions">
          En continuant, vous acceptez les conditions d'utilisation et la politique de
          confidentialité de Brandself.
        </p>
      </form>
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

.marque {
  font-family: var(--font-titre);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}

.formulaire {
  max-width: 30rem;
  width: 100%;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1 {
  font-size: clamp(2.25rem, 8vw, 2.75rem);
  font-weight: 600;
  line-height: 1.1;
  margin: 0.5rem 0 0;
}

.introduction {
  color: var(--texte-secondaire);
  font-size: 1.05rem;
  line-height: 1.5;
  margin: 0;
}

.bouton {
  min-height: 3.5rem;
  border-radius: 1rem;
  border: 1px solid var(--bordure);
  background-color: var(--champ);
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

.bouton-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  position: relative;
}

.bouton-google__marque {
  position: absolute;
  left: 1.5rem;
  display: inline-flex;
}

.bouton-principal {
  background-color: var(--accent);
  border-color: var(--accent);
  color: var(--champ);
}

.note-google,
.note-canal {
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin: -0.5rem 0 0;
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
  gap: 0.25rem;
  padding: 0.25rem;
  background-color: var(--accent-doux);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
}

.onglets button {
  min-height: 3rem;
  border: none;
  border-radius: 0.75rem;
  background: transparent;
  color: var(--encre);
  font-family: var(--font-texte);
  font-size: 1rem;
  cursor: pointer;
}

.onglets button.actif {
  background-color: var(--accent);
  color: var(--champ);
  font-weight: 600;
}

.onglets button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.champ-duo {
  display: grid;
  grid-template-columns: minmax(0, 8rem) minmax(0, 1fr);
  gap: 0.75rem;
}

.champ {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.champ label {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--encre);
}

.obligatoire {
  display: block;
  color: var(--erreur);
  font-weight: 600;
}

.champ input,
.champ select {
  min-height: 3.5rem;
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  background-color: var(--champ);
  padding: 0 1rem;
  font-size: 1rem;
  font-family: var(--font-texte);
  color: var(--encre);
}

.champ input::placeholder {
  color: var(--texte-secondaire);
}

.bloc-canal {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.legende {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}

.erreur {
  color: var(--erreur);
  font-size: 0.95rem;
  margin: 0;
}

.aide,
.mentions {
  font-size: 0.95rem;
  color: var(--texte-secondaire);
  line-height: 1.5;
  margin: 0;
}

.aide {
  margin-top: 0.5rem;
}

@media (min-width: 64rem) {
  .connexion {
    grid-template-columns: minmax(0, 45%) minmax(0, 55%);
    align-items: stretch;
  }

  .panneau {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2rem;
    padding: 3rem;
    background-color: var(--surface);
  }

  .panneau-marque {
    font-family: var(--font-titre);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
  }

  .panneau-titre {
    font-family: var(--font-titre);
    font-size: clamp(2.25rem, 3vw, 3rem);
    font-weight: 600;
    line-height: 1.15;
    margin: 0;
  }

  .panneau-points {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: var(--encre);
    font-size: 1.05rem;
  }

  .panneau-points li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .panneau-points :deep(svg) {
    color: var(--accent);
    flex-shrink: 0;
  }

  .panneau-bas {
    color: var(--texte-secondaire);
    font-size: 0.9rem;
    margin: 0;
  }

  .formulaire {
    justify-content: center;
    padding-top: 3rem;
    padding-bottom: 3rem;
  }
}
</style>
