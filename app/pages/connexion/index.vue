<script setup lang="ts">
type Canal = 'email' | 'telephone'

interface IdentifiantMemorise {
  canal: Canal
  valeur: string
}

const authClient = useAuthClient()
const googleActif = useRuntimeConfig().public.googleActif

const canal = ref<Canal>('email')
const email = ref('')
const indicatif = ref('+237')
const numero = ref('')
const chargement = ref(false)
const erreur = ref('')

const indicatifs = [
  { code: '+237', pays: 'Cameroun' },
  { code: '+229', pays: 'Bénin' },
  { code: '+225', pays: 'Côte d’Ivoire' },
  { code: '+221', pays: 'Sénégal' },
  { code: '+241', pays: 'Gabon' },
  { code: '+243', pays: 'RD Congo' },
  { code: '+226', pays: 'Burkina Faso' },
  { code: '+223', pays: 'Mali' },
  { code: '+228', pays: 'Togo' },
  { code: '+33', pays: 'France' },
  { code: '+32', pays: 'Belgique' },
  { code: '+41', pays: 'Suisse' },
  { code: '+1', pays: 'Canada / États-Unis' },
]

function memoriserIdentifiant(c: Canal, valeur: string): void {
  const identifiant: IdentifiantMemorise = { canal: c, valeur }
  sessionStorage.setItem('brandself:identifiant', JSON.stringify(identifiant))
}

function normaliserTelephone(): string {
  const chiffres = numero.value.replace(/\D/g, '')
  if (!chiffres) {
    return ''
  }
  return `${indicatif.value}${chiffres}`
}

function traduireErreur(message: string): string {
  if (/too many|rate limit/i.test(message)) {
    return 'Trop de tentatives. Patientez une minute avant de recommencer.'
  }
  if (/otp.*send|send.*otp/i.test(message)) {
    return "L'envoi du code a échoué. Réessayez dans un instant."
  }
  return message
}

async function envoyerCode(): Promise<void> {
  erreur.value = ''
  chargement.value = true
  try {
    if (!authClient) {
      erreur.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
      return
    }
    if (canal.value === 'email') {
      const valeur = email.value.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur)) {
        erreur.value = 'Entrez une adresse email valide.'
        return
      }
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: valeur,
        type: 'sign-in',
      })
      if (error) {
        erreur.value = traduireErreur(error.message ?? 'Erreur inconnue')
        return
      }
      memoriserIdentifiant('email', valeur)
    } else {
      const tel = normaliserTelephone()
      if (tel.replace(/\D/g, '').length < 6) {
        erreur.value = 'Entrez un numéro de téléphone valide.'
        return
      }
      const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: tel })
      if (error) {
        erreur.value = traduireErreur(error.message ?? 'Erreur inconnue')
        return
      }
      memoriserIdentifiant('telephone', tel)
    }
    await navigateTo('/connexion/code')
  } finally {
    chargement.value = false
  }
}

async function continuerAvecGoogle(): Promise<void> {
  erreur.value = ''
  if (!authClient) {
    erreur.value = 'La page a rencontré un problème. Rechargez-la et réessayez.'
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
        @click="continuerAvecGoogle"
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
          :aria-selected="canal === 'email'"
          :class="{ actif: canal === 'email' }"
          @click="canal = 'email'"
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="canal === 'telephone'"
          :class="{ actif: canal === 'telephone' }"
          @click="canal = 'telephone'"
        >
          Téléphone
        </button>
      </div>

      <form novalidate @submit.prevent="envoyerCode">
        <div v-if="canal === 'email'" class="champ">
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
          <label for="indicatif">Indicatif</label>
          <select id="indicatif" v-model="indicatif">
            <option v-for="i in indicatifs" :key="i.code" :value="i.code">
              {{ i.code }} — {{ i.pays }}
            </option>
          </select>
          <label for="numero">Numéro de téléphone</label>
          <input
            id="numero"
            v-model="numero"
            type="tel"
            name="tel"
            autocomplete="tel-national"
            inputmode="tel"
            placeholder="6 90 00 00 00"
          >
        </div>

        <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

        <button type="submit" class="bouton bouton-principal" :disabled="chargement">
          {{ chargement ? 'Envoi en cours…' : 'Recevoir mon code' }}
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
