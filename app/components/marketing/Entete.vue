<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { NAV_LIENS, ROUTE_CONNEXION } from '~/data/landing'

// Barre fixe en haut : filet au défilement, menu burger sous 961 px (fermé au clic sur un lien et à Échap).
const TEXTES = {
  evitement: 'Aller au contenu',
  navigation: 'Navigation principale',
  connexion: 'Connexion',
  creer: 'Créer ma vitrine',
  ouvrir: 'Ouvrir le menu',
  fermer: 'Fermer le menu',
} as const

const SEUIL_FILET_PX = 8
const ID_MENU = 'menu-accueil'

const { lienNav, lienCreer, lienLogo } = useLiensMarketing()

const ouvert = ref(false)
const defile = ref(false)

function surDefilement(): void {
  defile.value = window.scrollY > SEUIL_FILET_PX
}

function fermer(): void {
  ouvert.value = false
}

function surClicMenu(evenement: MouseEvent): void {
  if ((evenement.target as HTMLElement).closest('a')) fermer()
}

const entete = useTemplateRef<HTMLElement>('entete')
const burger = useTemplateRef<HTMLButtonElement>('burger')

// Menu ouvert : Échap (focus rendu au burger) et clic extérieur ferment, où que soit le focus.
function surTouche(evenement: KeyboardEvent): void {
  if (evenement.key !== 'Escape') return
  fermer()
  burger.value?.focus()
}

function surClicDocument(evenement: MouseEvent): void {
  // composedPath : le chemin est figé au déclenchement (l'icône cliquée peut déjà avoir été remplacée dans le DOM).
  if (entete.value && !evenement.composedPath().includes(entete.value)) fermer()
}

function retirerEcouteurs(): void {
  document.removeEventListener('keydown', surTouche)
  document.removeEventListener('click', surClicDocument)
}

watch(ouvert, (estOuvert) => {
  retirerEcouteurs()
  if (!estOuvert) return
  document.addEventListener('keydown', surTouche)
  document.addEventListener('click', surClicDocument)
})

onMounted(() => {
  surDefilement()
  window.addEventListener('scroll', surDefilement, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', surDefilement)
  retirerEcouteurs()
})
</script>

<template>
  <header ref="entete" class="sticky top-0 z-40 border-b bg-fond transition-colors" :class="defile || ouvert ? 'border-bordure' : 'border-transparent'">
    <a
      href="#haut"
      class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-(--rayon-interne) focus:bg-encre focus:px-4 focus:py-3 focus:text-fond"
    >{{ TEXTES.evitement }}</a>

    <div class="mx-auto flex min-h-18 w-full max-w-290 items-center justify-between gap-4 px-4 md:px-6">
      <NuxtLink :to="lienLogo" :aria-label="`${MARQUE.nom}, accueil`" class="inline-flex min-h-(--cible-tactile) items-center">
        <BsLogo variante="wordmark" class="h-8 md:hidden" />
        <BsLogo variante="horizontal" class="hidden h-10 md:block" />
      </NuxtLink>

      <nav :aria-label="TEXTES.navigation" class="flex items-center gap-1 max-[960px]:hidden">
        <NuxtLink
          v-for="lien in NAV_LIENS"
          :key="lien.ancre"
          :to="lienNav(lien.ancre)"
          class="inline-flex min-h-(--cible-tactile) min-w-(--cible-tactile) items-center justify-center rounded-(--rayon-interne) px-3.5 font-medium text-encre no-underline transition-colors hover:bg-surface"
        >
          {{ lien.libelle }}
        </NuxtLink>
      </nav>

      <div class="flex items-center gap-2">
        <NuxtLink
          :to="ROUTE_CONNEXION"
          class="inline-flex min-h-(--cible-tactile) items-center rounded-(--rayon-interne) px-3.5 font-semibold text-encre no-underline transition-colors hover:bg-surface max-[960px]:hidden"
        >
          {{ TEXTES.connexion }}
        </NuxtLink>
        <BsButton :to="lienCreer" class="min-h-(--cible-tactile)! px-4! max-[520px]:px-3! max-[520px]:text-sm!">
          {{ TEXTES.creer }}
        </BsButton>
        <button
          ref="burger"
          type="button"
          class="inline-grid size-11 cursor-pointer place-items-center rounded-(--rayon-interne) border border-bordure bg-transparent text-encre transition-colors hover:bg-surface min-[961px]:hidden"
          :aria-expanded="ouvert"
          :aria-controls="ID_MENU"
          :aria-label="ouvert ? TEXTES.fermer : TEXTES.ouvrir"
          @click="ouvert = !ouvert"
        >
          <UIcon :name="ouvert ? 'i-ph-x' : 'i-ph-list'" class="size-6" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="ouvert" :id="ID_MENU" class="border-t border-bordure bg-fond min-[961px]:hidden" @click="surClicMenu">
      <nav :aria-label="TEXTES.navigation" class="mx-auto grid w-full max-w-290 px-4 pt-2 pb-5 md:px-6">
        <NuxtLink
          v-for="lien in NAV_LIENS"
          :key="lien.ancre"
          :to="lienNav(lien.ancre)"
          class="flex min-h-(--cible-tactile) items-center border-b border-bordure py-3 font-(family-name:--font-titre) text-(length:--fs-24) font-medium text-encre no-underline"
        >
          {{ lien.libelle }}
        </NuxtLink>
        <NuxtLink
          :to="ROUTE_CONNEXION"
          class="flex min-h-(--cible-tactile) items-center border-b border-bordure py-3 font-(family-name:--font-titre) text-(length:--fs-24) font-medium text-encre no-underline"
        >
          {{ TEXTES.connexion }}
        </NuxtLink>
        <BsButton :to="lienCreer" block class="mt-4">
          {{ TEXTES.creer }}
        </BsButton>
      </nav>
    </div>
  </header>
</template>
