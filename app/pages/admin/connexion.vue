<script setup lang="ts">
import { ADMIN_PREFIXE_PAGES } from '#shared/admin'
import type { ErreurEnvoiCode } from '../../composables/useErreurEnvoiCode'

type Etape = 'email' | 'code'

const CODE_LENGTH = 6
const DELAI_RENVOI_S = 60
const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Message identique quelle que soit l'adresse : rien ne dit si elle est autorisée.
const MESSAGE_NEUTRE = 'Si cette adresse est autorisée, un code vient d’être envoyé.'
// Message générique : ne distingue ni code faux, ni code expiré, ni compte refusé.
const ERREUR_CODE = 'Code invalide ou expiré.'
const ERREUR_EMAIL = 'Entrez une adresse email valide.'

useSeoMeta({ title: 'Connexion · Administration', robots: 'noindex, nofollow' })

// Mêmes routes Better Auth e-mail OTP que la connexion du studio : aucun Google, aucun téléphone. Appels à
// l'ORIGINE COURANTE (hôte d'administration) : le client du module vise `siteUrl` (hôte public), donc pas utilisé ici.
const baseAuth = (): string => baseUrlAuthAdmin(window.location.origin)

/** Erreur d'un appel d'authentification, au format attendu par `messageErreurEnvoiCode`. */
function erreurAuth(e: unknown): ErreurEnvoiCode {
  const reponse = e as { status?: number, statusCode?: number, data?: { message?: unknown } } | null
  const message = reponse?.data?.message
  return { status: reponse?.status ?? reponse?.statusCode, message: typeof message === 'string' ? message : undefined }
}
const { charger } = useAdminSession()
const { remaining: secondesRestantes, start: demarrerDelaiRenvoi } = useCountdown(DELAI_RENVOI_S)

const etape = ref<Etape>('email')
const email = ref('')
// Un chiffre par case (UPinInput en mode numérique) ; une case vidée n'est plus un nombre.
const chiffres = ref<number[]>([])
const enCours = ref(false)
const erreur = ref('')
const erreurChamp = ref('')
const codeRejete = ref(false)

const codeComplet = computed(() =>
  Array.from({ length: CODE_LENGTH }, (_, i) => chiffres.value[i]).every((c) => typeof c === 'number'),
)

function effacerErreurs(): void {
  erreur.value = ''
  erreurChamp.value = ''
  codeRejete.value = false
}

// Déjà connecté : la connexion n'a pas d'objet.
onMounted(async () => {
  if (await charger()) await navigateTo(ADMIN_PREFIXE_PAGES)
})

/** Demande un code. Vrai si la demande est partie (la réponse du serveur est la même pour toute adresse). */
async function demanderCode(): Promise<boolean> {
  try {
    await $fetch(`${baseAuth()}/email-otp/send-verification-otp`, {
      method: 'POST',
      body: { email: email.value, type: 'sign-in' },
    })
    demarrerDelaiRenvoi()
    return true
  } catch (e) {
    erreur.value = messageErreurEnvoiCode(erreurAuth(e))
    return false
  }
}

async function envoyerCode(): Promise<void> {
  effacerErreurs()
  email.value = email.value.trim().toLowerCase()
  if (!FORMAT_EMAIL.test(email.value)) {
    erreurChamp.value = ERREUR_EMAIL
    return
  }
  enCours.value = true
  try {
    if (await demanderCode()) {
      chiffres.value = []
      etape.value = 'code'
    }
  } finally {
    enCours.value = false
  }
}

async function renvoyerCode(): Promise<void> {
  if (secondesRestantes.value > 0 || enCours.value) return
  effacerErreurs()
  enCours.value = true
  try {
    await demanderCode()
  } finally {
    enCours.value = false
  }
}

async function verifierCode(): Promise<void> {
  if (!codeComplet.value || enCours.value) return
  effacerErreurs()
  enCours.value = true
  try {
    await $fetch(`${baseAuth()}/sign-in/email-otp`, {
      method: 'POST',
      body: { email: email.value, otp: chiffres.value.join('') },
    })
    await navigateTo(ADMIN_PREFIXE_PAGES)
  } catch {
    erreur.value = ERREUR_CODE
    codeRejete.value = true
  } finally {
    enCours.value = false
  }
}

function modifierAdresse(): void {
  effacerErreurs()
  chiffres.value = []
  etape.value = 'email'
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-120 flex-col gap-4 px-6 pt-8 pb-12">
    <template v-if="etape === 'email'">
      <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">
        Connexion
      </h1>

      <form class="flex flex-col gap-4" novalidate @submit.prevent="envoyerCode">
        <UFormField label="Adresse email" name="email" :error="erreurChamp">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            autofocus
            required
            :disabled="enCours"
          />
        </UFormField>

        <UAlert
          v-if="erreur"
          role="alert"
          color="error"
          variant="soft"
          icon="i-ph-warning-circle"
          :description="erreur"
        />

        <UButton type="submit" block :loading="enCours">
          {{ enCours ? 'Envoi en cours…' : 'Recevoir un code' }}
        </UButton>
      </form>
    </template>

    <template v-else>
      <UButton
        color="neutral"
        variant="link"
        size="lg"
        icon="i-ph-arrow-left"
        class="-ml-3 self-start font-normal"
        :disabled="enCours"
        @click="modifierAdresse"
      >
        Modifier l’adresse
      </UButton>

      <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">
        Saisissez votre code
      </h1>
      <p role="status" class="text-muted">
        {{ MESSAGE_NEUTRE }}
      </p>

      <form novalidate @submit.prevent="verifierCode">
        <UPinInput
          v-model="chiffres"
          type="number"
          otp
          autofocus
          :length="CODE_LENGTH"
          :color="codeRejete ? 'error' : 'primary'"
          :highlight="codeRejete"
          :disabled="enCours"
          @update:model-value="effacerErreurs"
        />
      </form>

      <UAlert
        v-if="erreur"
        role="alert"
        color="error"
        variant="soft"
        icon="i-ph-warning-circle"
        :description="erreur"
      />

      <UButton block :loading="enCours" :disabled="!codeComplet" @click="verifierCode">
        {{ enCours ? 'Vérification…' : 'Valider' }}
      </UButton>

      <p v-if="secondesRestantes > 0" class="flex min-h-(--cible-tactile) items-center text-muted">
        Renvoyer le code dans {{ secondesRestantes }} s
      </p>
      <UButton
        v-else
        variant="link"
        size="lg"
        class="-ml-3 self-start font-medium underline underline-offset-4"
        :loading="enCours"
        @click="renvoyerCode"
      >
        Renvoyer le code
      </UButton>
    </template>
  </main>
</template>
