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
// Erreur de saisie (champ à corriger) : distincte d'une erreur d'envoi.
const fieldInvalid = ref(false)

const ERREUR_ENVOI = "Nous n'avons pas pu envoyer le code. Réessayez dans un instant."
const ERREUR_PAGE = 'La page a rencontré un problème. Rechargez-la et réessayez.'

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

const selectedCountry = computed(
  () => countryCodes.find((c) => c.code === countryCode.value)?.country ?? '',
)

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

watch(channel, () => {
  error.value = ''
  fieldInvalid.value = false
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
  return ERREUR_ENVOI
}

function rejectField(message: string): void {
  error.value = message
  fieldInvalid.value = true
}

async function sendCode(): Promise<void> {
  error.value = ''
  fieldInvalid.value = false
  loading.value = true
  try {
    if (!authClient) {
      error.value = ERREUR_PAGE
      return
    }
    if (channel.value === 'email') {
      const value = email.value.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        rejectField('Entrez une adresse email valide.')
        return
      }
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
        email: value,
        type: 'sign-in',
      })
      if (sendError) {
        error.value = translateError(sendError.message ?? '')
        return
      }
      storeIdentifier('email', value)
    } else {
      const phone = normalizePhone()
      if (phone.replace(/\D/g, '').length < 6) {
        rejectField('Entrez un numéro de téléphone valide.')
        return
      }
      const { error: sendError } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone })
      if (sendError) {
        error.value = translateError(sendError.message ?? '')
        return
      }
      storeIdentifier('telephone', phone)
    }
    await navigateTo('/connexion/code')
  } catch {
    error.value = ERREUR_ENVOI
  } finally {
    loading.value = false
  }
}

async function continueWithGoogle(): Promise<void> {
  error.value = ''
  fieldInvalid.value = false
  if (!authClient) {
    error.value = ERREUR_PAGE
    return
  }
  try {
    await authClient.signIn.social({ provider: 'google', callbackURL: '/onboarding' })
  } catch {
    error.value = 'Nous n\'avons pas pu ouvrir Google. Réessayez dans un instant.'
  }
}
</script>

<template>
  <div class="connexion">
    <aside class="panneau">
      <p class="panneau-marque">Brandself</p>
      <p class="panneau-titre">Votre vitrine professionnelle, prête en quelques minutes.</p>
      <ul class="panneau-points">
        <li>
          <PhosphorIcon name="check" weight="bold" size="1.25rem" aria-hidden="true" />
          <span>Une adresse simple à partager</span>
        </li>
        <li>
          <PhosphorIcon name="check" weight="bold" size="1.25rem" aria-hidden="true" />
          <span>Des rendez-vous réservables en ligne</span>
        </li>
        <li>
          <PhosphorIcon name="check" weight="bold" size="1.25rem" aria-hidden="true" />
          <span>Aucun mot de passe à retenir</span>
        </li>
      </ul>
      <p class="panneau-bas">Créé avec soin à Douala</p>
    </aside>

    <main class="colonne-auth formulaire">
      <p class="marque">Brandself</p>

      <h1 class="titre-auth">Bienvenue</h1>
      <p class="texte-intro">
        Connectez-vous ou créez votre vitrine en quelques instants. Aucun mot de passe à retenir.
      </p>

      <BsButton
        variant="neutre"
        block
        :disabled="!googleActif"
        @click="continueWithGoogle"
      >
        <!-- Les quatre couleurs du « G » sont celles de la marque Google :
             elles sont imposées par ses règles d'utilisation, ce ne sont pas
             des couleurs de la palette Brandself. -->
        <span class="pastille-google" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="18" height="18" focusable="false">
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
      </BsButton>
      <p v-if="!googleActif" class="note note-remonte">
        Connexion Google bientôt disponible. Utilisez votre email ou votre téléphone pour l'instant.
      </p>

      <div class="separateur" aria-hidden="true">ou</div>

      <div class="segment" role="radiogroup" aria-label="Canal de connexion">
        <label class="segment__option">
          <input v-model="channel" type="radio" name="canal" value="email">
          <span>Email</span>
        </label>
        <label class="segment__option">
          <input v-model="channel" type="radio" name="canal" value="telephone">
          <span>Téléphone</span>
        </label>
      </div>

      <form class="saisies" novalidate @submit.prevent="sendCode">
        <div v-if="channel === 'email'" class="champ">
          <label for="email" class="champ-label">Adresse email</label>
          <input
            id="email"
            v-model="email"
            class="saisie"
            type="email"
            name="email"
            autocomplete="email"
            inputmode="email"
            placeholder="adresse@exemple.com"
            required
            :aria-invalid="fieldInvalid"
            :aria-describedby="fieldInvalid ? 'erreur-connexion' : undefined"
          >
        </div>

        <div v-else class="champ-duo">
          <div class="champ">
            <label for="country-code" class="champ-label">Indicatif</label>
            <!-- Seul l'indicatif est affiché ; la liste native garde le nom des pays. -->
            <div class="indicatif">
              <span class="indicatif__valeur" aria-hidden="true">{{ countryCode }}</span>
              <PhosphorIcon
                class="indicatif__fleche"
                name="caret-down"
                size="1rem"
                aria-hidden="true"
              />
              <select
                id="country-code"
                v-model="countryCode"
                class="indicatif__select"
                :title="selectedCountry"
              >
                <option v-for="c in countryCodes" :key="c.code" :value="c.code">
                  {{ c.code }} {{ c.country }}
                </option>
              </select>
            </div>
          </div>
          <div class="champ">
            <label for="phone-number" class="champ-label">Numéro de téléphone</label>
            <input
              id="phone-number"
              v-model="number"
              class="saisie"
              type="tel"
              name="tel"
              autocomplete="tel-national"
              inputmode="tel"
              placeholder="6 12 34 56 78"
              required
              :aria-invalid="fieldInvalid"
              :aria-describedby="fieldInvalid ? 'erreur-connexion' : undefined"
            >
          </div>
        </div>

        <div v-if="channel === 'telephone'" class="champ">
          <p id="canal-label" class="champ-label">Recevoir le code par</p>
          <div class="segment" role="radiogroup" aria-labelledby="canal-label">
            <label class="segment__option">
              <input type="radio" name="envoi" value="sms" checked>
              <span>SMS</span>
            </label>
            <label class="segment__option">
              <input
                type="radio"
                name="envoi"
                value="whatsapp"
                disabled
                aria-describedby="note-whatsapp"
              >
              <span>WhatsApp</span>
            </label>
          </div>
          <p v-if="!whatsappActif" id="note-whatsapp" class="note">WhatsApp arrive bientôt.</p>
        </div>

        <p v-if="error" id="erreur-connexion" class="message-erreur" role="alert">
          <PhosphorIcon name="warning-circle" size="1.25rem" aria-hidden="true" />
          <span>{{ error }}</span>
        </p>

        <BsButton type="submit" block :loading="loading">
          {{ loading ? 'Envoi en cours…' : 'Recevoir un code' }}
        </BsButton>

        <p class="texte-intro">{{ aideEnvoi }}</p>

        <p class="note">
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
  font-size: var(--fs-24);
  font-weight: 700;
  color: var(--encre);
  margin: 0;
}

.saisies {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.note-remonte {
  margin-top: -0.5rem;
}

.pastille-google {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--bordure);
  border-radius: 50%;
  background-color: var(--champ);
}

.separateur {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--texte-secondaire);
  font-size: var(--fs-14);
}

.separateur::before,
.separateur::after {
  content: "";
  flex: 1;
  height: 1px;
  background-color: var(--bordure);
}

.champ-duo {
  display: grid;
  grid-template-columns: minmax(0, 8rem) minmax(0, 1fr);
  gap: 0.75rem;
}

.indicatif {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: var(--hauteur-controle);
  border: 1px solid var(--bordure);
  border-radius: var(--rayon);
  background-color: var(--champ);
  color: var(--encre);
  font-size: var(--fs-16);
  transition: border-color var(--transition);
}

.indicatif:hover {
  border-color: var(--texte-secondaire);
}

.indicatif:has(.indicatif__select:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.indicatif__fleche {
  color: var(--texte-secondaire);
}

/* Le vrai <select> recouvre la pastille : natif, clavier et lecteurs d'écran. */
.indicatif__select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.indicatif__select:focus-visible {
  outline: none;
}

@media (min-width: 64rem) {
  .connexion {
    grid-template-columns: minmax(0, 45%) minmax(0, 55%);
    align-items: stretch;
  }

  .marque {
    display: none;
  }

  .panneau {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2rem;
    padding: 3rem;
    background-color: var(--accent-doux);
  }

  .panneau-marque {
    font-family: var(--font-titre);
    font-size: var(--fs-24);
    font-weight: 700;
    margin: 0;
  }

  .panneau-titre {
    font-family: var(--font-titre);
    font-size: var(--fs-48);
    font-weight: 700;
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
    font-size: var(--fs-20);
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
    font-size: var(--fs-14);
    margin: 0;
  }

  .formulaire {
    justify-content: center;
    padding-top: 3rem;
    padding-bottom: 3rem;
  }
}
</style>
