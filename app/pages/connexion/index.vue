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

// Le bouton affiche l'indicatif seul ; la liste ajoute le nom du pays.
const countryItems = countryCodes.map((c) => ({
  label: c.code,
  value: c.code,
  description: c.country,
}))

const channelItems = [
  { label: 'Email', value: 'email' },
  { label: 'Téléphone', value: 'telephone' },
]

// WhatsApp : fournisseur non branché (décision ouverte, PROJECT_STATE.md §3).
// Le choix reste visible mais inactif tant que la passerelle n'existe pas.
const whatsappActif = false

const sendMode = ref('sms')
const sendModeItems = [
  { label: 'SMS', value: 'sms' },
  { label: 'WhatsApp', value: 'whatsapp', disabled: !whatsappActif },
]

const pointsPanneau = [
  'Une adresse simple à partager',
  'Des rendez-vous réservables en ligne',
  'Aucun mot de passe à retenir',
]

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
  <div class="grid min-h-screen lg:grid-cols-[45fr_55fr]">
    <aside class="hidden flex-col justify-between gap-8 bg-accent-doux p-12 lg:flex">
      <p class="font-(family-name:--font-titre) text-(length:--fs-24) font-bold">Brandself</p>
      <p class="font-(family-name:--font-titre) text-(length:--fs-48) leading-[1.15] font-bold">
        Votre vitrine professionnelle, prête en quelques minutes.
      </p>
      <ul class="flex flex-col gap-4 text-(length:--fs-20)">
        <li v-for="point in pointsPanneau" :key="point" class="flex items-center gap-3">
          <UIcon name="i-ph-check" class="size-5 shrink-0 text-primary" />
          <span>{{ point }}</span>
        </li>
      </ul>
      <p class="text-sm text-muted">Créé avec soin à Douala</p>
    </aside>

    <main class="mx-auto flex w-full max-w-120 flex-col gap-4 px-6 pt-8 pb-12 lg:justify-center lg:py-12">
      <p class="font-(family-name:--font-titre) text-(length:--fs-24) font-bold lg:hidden">Brandself</p>

      <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">
        Bienvenue
      </h1>
      <p class="text-muted">
        Connectez-vous ou créez votre vitrine en quelques instants. Aucun mot de passe à retenir.
      </p>

      <UButton
        color="neutral"
        variant="outline"
        block
        class="font-medium"
        :disabled="!googleActif"
        @click="continueWithGoogle"
      >
        <template #leading>
          <!-- Les quatre couleurs du « G » sont celles de la marque Google :
               elles sont imposées par ses règles d'utilisation, ce ne sont pas
               des couleurs de la palette Brandself. -->
          <span
            class="inline-flex size-8 items-center justify-center rounded-full border border-default bg-default"
            aria-hidden="true"
          >
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
        </template>
        Continuer avec Google
      </UButton>
      <p v-if="!googleActif" class="-mt-2 text-sm text-muted">
        Connexion Google bientôt disponible. Utilisez votre email ou votre téléphone pour l'instant.
      </p>

      <USeparator label="ou" />

      <UTabs
        v-model="channel"
        :items="channelItems"
        :content="false"
        aria-label="Canal de connexion"
      />

      <form class="flex flex-col gap-4" novalidate @submit.prevent="sendCode">
        <UFormField v-if="channel === 'email'" label="Adresse email" name="email" :error="fieldInvalid">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            placeholder="adresse@exemple.com"
            required
          />
        </UFormField>

        <div v-else class="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
          <UFormField label="Indicatif" name="country-code">
            <USelect
              v-model="countryCode"
              :items="countryItems"
              :ui="{ content: 'min-w-64' }"
            />
          </UFormField>
          <UFormField label="Numéro de téléphone" name="tel" :error="fieldInvalid">
            <UInput
              v-model="number"
              type="tel"
              autocomplete="tel-national"
              inputmode="tel"
              placeholder="6 12 34 56 78"
              required
            />
          </UFormField>
        </div>

        <UFormField
          v-if="channel === 'telephone'"
          label="Recevoir le code par"
          name="envoi"
          :help="whatsappActif ? undefined : 'WhatsApp arrive bientôt.'"
        >
          <UTabs
            v-model="sendMode"
            :items="sendModeItems"
            :content="false"
            aria-label="Mode d'envoi du code"
          />
        </UFormField>

        <UAlert
          v-if="error"
          id="erreur-connexion"
          role="alert"
          color="error"
          variant="soft"
          icon="i-ph-warning-circle"
          :description="error"
        />

        <UButton type="submit" block :loading="loading">
          {{ loading ? 'Envoi en cours…' : 'Recevoir un code' }}
        </UButton>

        <p class="text-muted">{{ aideEnvoi }}</p>

        <p class="text-sm text-muted">
          En continuant, vous acceptez les conditions d'utilisation et la politique de
          confidentialité de Brandself.
        </p>
      </form>
    </main>
  </div>
</template>
