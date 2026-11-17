<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { validateUsername } from '#shared/schemas/username'
import { ADRESSES_EXEMPLES } from '~/data/landing'

// Champ d'adresse de la page d'accueil (hero et clôture). Aucune disponibilité n'est annoncée : il n'existe pas
// d'API publique pour la vérifier. Seul le FORMAT est contrôlé, avec le schéma réel du projet (`schemaUsername`,
// mots réservés compris). La valeur est partagée entre les deux champs par `useState`.

const TEXTES = {
  libelle: 'Choisissez votre adresse',
  action: 'Créer ma vitrine',
  vide: 'Écrivez d’abord l’adresse que vous voulez.',
  invalide: 'Cette adresse n’est pas valide.',
} as const

const ROUTE_CONNEXION = '/connexion'
const LONGUEUR_MAX = 30
const INTERVALLE_EXEMPLES_MS = 2400
const PREFIXE = `${MARQUE.domaine}/`

const idChamp = useId()
const idMessage = useId()

const adresse = useState<string>('landing-adresse', () => '')
// Mémorisée à la soumission pour être reprise à l'onboarding (un paramètre d'URL ne survivrait pas au code reçu).
const adresseSouhaitee = useAdresseSouhaitee()
const tentative = ref(false)
const champ = useTemplateRef<HTMLInputElement>('champ')
const exemple = ref(0)
const placeholder = computed(() => ADRESSES_EXEMPLES[exemple.value] ?? '')

/** Écriture libre -> adresse : sans accent, minuscules, espaces en tirets, caractères non admis retirés. */
function versAdresse(saisie: string): string {
  return saisie
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .slice(0, LONGUEUR_MAX)
}

function surSaisie(evenement: Event): void {
  const cible = evenement.target as HTMLInputElement
  adresse.value = versAdresse(cible.value)
  cible.value = adresse.value
}

const valeur = computed(() => adresse.value.replace(/-$/, ''))

const message = computed(() => {
  if (!tentative.value) return ''
  if (valeur.value === '') return TEXTES.vide
  const resultat = validateUsername(valeur.value)
  if (resultat.success) return ''
  const premier = resultat.error.issues[0]?.message ?? TEXTES.invalide
  return `${premier.charAt(0).toUpperCase()}${premier.slice(1)}.`
})

async function soumettre(): Promise<void> {
  tentative.value = true
  if (message.value !== '') {
    if (valeur.value === '') champ.value?.focus()
    return
  }
  adresseSouhaitee.value = valeur.value
  await navigateTo(ROUTE_CONNEXION)
}

// Exemples qui défilent dans le champ vide (jamais en mouvement réduit, jamais pendant la saisie).
let minuteur: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  minuteur = setInterval(() => {
    if (adresse.value !== '' || document.activeElement === champ.value) return
    exemple.value = (exemple.value + 1) % ADRESSES_EXEMPLES.length
  }, INTERVALLE_EXEMPLES_MS)
})
onBeforeUnmount(() => clearInterval(minuteur))
</script>

<template>
  <form class="flex w-full flex-col gap-2 text-left" novalidate @submit.prevent="soumettre">
    <label :for="idChamp" class="text-(length:--fs-14) font-semibold text-texte-secondaire">{{ TEXTES.libelle }}</label>
    <div
      class="flex flex-col gap-1 rounded-[calc(var(--rayon)+0.375rem)] border-2 bg-champ p-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:flex-row sm:items-center"
      :class="message ? 'border-erreur' : 'border-encre'"
    >
      <div class="flex min-w-0 flex-1 items-center pl-3">
        <span class="whitespace-nowrap text-(length:--fs-16) font-semibold text-texte-secondaire" aria-hidden="true">{{ PREFIXE }}</span>
        <input
          :id="idChamp"
          ref="champ"
          :value="adresse"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          :maxlength="LONGUEUR_MAX"
          :placeholder="placeholder"
          :aria-invalid="message ? true : undefined"
          :aria-describedby="idMessage"
          class="min-h-(--hauteur-controle) min-w-0 flex-1 bg-transparent px-1 text-(length:--fs-20) font-semibold text-encre outline-none placeholder:font-medium placeholder:text-texte-secondaire"
          @input="surSaisie"
        >
      </div>
      <div class="w-full sm:w-auto">
        <BsButton type="submit" block>
          {{ TEXTES.action }}
        </BsButton>
      </div>
    </div>
    <p :id="idMessage" class="m-0 min-h-6 text-center text-(length:--fs-14) font-semibold text-erreur" aria-live="polite">
      {{ message }}
    </p>
  </form>
</template>
