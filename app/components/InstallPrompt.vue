<script setup lang="ts">
import { computed } from 'vue'
import { MARQUE } from '#shared/brand'
import { libelleAppareilInstallation } from '../utils/pwa-install'

// Feuille d'installation du studio : NON modale (aucun voile, aucun piège du focus, la page reste utilisable).
// Quand l'afficher (2e visite, pas pendant une saisie…) est décidé par useInstallPrompt.
const { visible, iosSafari, appareil, plusTard, refuser, installer } = useInstallPrompt()

const titreAppareil = computed(() => `Installez ${MARQUE.nom} ${libelleAppareilInstallation(appareil.value)}`)
const estMobile = computed(() => appareil.value === 'mobile')
</script>

<template>
  <aside v-if="visible" data-pwa-install :aria-label="`Installer ${MARQUE.nom}`" data-testid="install-prompt">
    <!-- iPhone : feuille du bas, instructions manuelles (Safari n'expose pas d'installation par bouton). -->
    <div v-if="iosSafari" class="fixed inset-x-2 bottom-2 z-40 rounded-(--rayon-interne) border border-bordure bg-fond pb-[env(safe-area-inset-bottom)] shadow-2xl">
      <div class="px-6 pb-4 pt-6 sm:mx-auto sm:max-w-md">
        <div class="mb-5 flex items-center gap-3">
          <span class="flex size-14 shrink-0 items-center justify-center rounded-xl border border-bordure bg-surface">
            <img src="/brand/icone.png" alt="" class="size-9" aria-hidden="true">
          </span>
          <h2 class="m-0 min-w-0 flex-1 text-(length:--fs-24) leading-tight font-bold text-encre">Installez {{ MARQUE.nom }} sur votre iPhone</h2>
          <button
            type="button"
            class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-transparent text-texte-secondaire transition-colors hover:bg-surface hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Fermer, me le rappeler plus tard"
            data-testid="install-fermer"
            @click="plusTard"
          >
            <UIcon name="i-ph-x" size="20" aria-hidden="true" />
          </button>
        </div>
        <ol class="m-0 list-none space-y-4 p-0">
          <li class="flex items-center gap-3">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-doux text-(length:--fs-14) font-bold text-accent-texte" aria-hidden="true">1</span>
            <p class="m-0 min-w-0 flex-1 text-base text-encre">Touchez le bouton Partager en bas de l’écran</p>
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-bordure bg-champ">
              <UIcon name="i-ph-upload-simple" size="20" class="text-encre" aria-hidden="true" />
            </span>
          </li>
          <li class="flex items-center gap-3">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-doux text-(length:--fs-14) font-bold text-accent-texte" aria-hidden="true">2</span>
            <p class="m-0 min-w-0 flex-1 text-base text-encre">Faites défiler, puis touchez « Sur l’écran d’accueil »</p>
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-bordure bg-champ">
              <UIcon name="i-ph-square-plus" size="20" class="text-encre" aria-hidden="true" />
            </span>
          </li>
          <li class="flex items-center gap-3">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-doux text-(length:--fs-14) font-bold text-accent-texte" aria-hidden="true">3</span>
            <p class="m-0 min-w-0 flex-1 text-base text-encre">Touchez « Ajouter »</p>
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-bordure bg-champ">
              <UIcon name="i-ph-check" size="20" class="text-encre" aria-hidden="true" />
            </span>
          </li>
        </ol>
        <div class="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            class="min-h-11 cursor-pointer bg-transparent px-3 text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-testid="install-plus-tard"
            @click="plusTard"
          >
            Plus tard
          </button>
          <button
            type="button"
            class="min-h-11 cursor-pointer bg-transparent px-3 text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-testid="install-refuser"
            @click="refuser"
          >
            Non merci
          </button>
        </div>
      </div>
    </div>

    <!-- Téléphone (Android) : feuille du bas, bouton pleine largeur. -->
    <div v-else-if="estMobile" class="fixed inset-x-2 bottom-2 z-40 rounded-(--rayon-interne) border border-bordure bg-fond pb-[env(safe-area-inset-bottom)] shadow-2xl">
      <div class="px-6 pb-4 pt-6 sm:mx-auto sm:max-w-md">
        <div class="mb-4 flex items-center gap-3">
          <span class="flex size-14 shrink-0 items-center justify-center rounded-xl border border-bordure bg-surface">
            <img src="/brand/icone.png" alt="" class="size-9" aria-hidden="true">
          </span>
          <h2 class="m-0 min-w-0 flex-1 text-(length:--fs-24) leading-tight font-bold text-encre">{{ titreAppareil }}</h2>
          <button
            type="button"
            class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-transparent text-texte-secondaire transition-colors hover:bg-surface hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Fermer, me le rappeler plus tard"
            data-testid="install-fermer"
            @click="plusTard"
          >
            <UIcon name="i-ph-x" size="20" aria-hidden="true" />
          </button>
        </div>
        <p class="m-0 mb-6 text-base text-texte-secondaire">Ouvrez votre studio comme une application.</p>
        <button
          type="button"
          class="min-h-12 w-full cursor-pointer rounded-xl bg-accent text-base font-semibold text-sur-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="install-installer"
          @click="installer"
        >
          Installer
        </button>
        <div class="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            class="min-h-11 cursor-pointer bg-transparent px-3 text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-testid="install-plus-tard"
            @click="plusTard"
          >
            Plus tard
          </button>
          <button
            type="button"
            class="min-h-11 cursor-pointer bg-transparent px-3 text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-testid="install-refuser"
            @click="refuser"
          >
            Non merci
          </button>
        </div>
      </div>
    </div>

    <!-- Tablette / ordinateur : petite carte en bas à droite. -->
    <div v-else class="fixed bottom-4 right-4 z-40 w-80 rounded-2xl border border-bordure bg-fond p-6 shadow-2xl">
      <div class="flex items-start gap-3">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-bordure bg-surface">
          <img src="/brand/icone.png" alt="" class="size-8" aria-hidden="true">
        </span>
        <h2 class="m-0 min-w-0 flex-1 text-(length:--fs-20) leading-snug font-bold text-encre">{{ titreAppareil }}</h2>
        <button
          type="button"
          class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-transparent text-texte-secondaire transition-colors hover:bg-surface hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label="Fermer, me le rappeler plus tard"
          data-testid="install-fermer"
          @click="plusTard"
        >
          <UIcon name="i-ph-x" size="20" aria-hidden="true" />
        </button>
      </div>
      <p class="m-0 mb-5 mt-4 text-base text-texte-secondaire">Ouvrez votre studio comme une application.</p>
      <button
        type="button"
        class="min-h-11 w-full cursor-pointer rounded-xl bg-accent text-base font-semibold text-sur-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        data-testid="install-installer"
        @click="installer"
      >
        Installer
      </button>
      <div class="mt-2 flex items-center justify-center gap-2">
        <button
          type="button"
          class="min-h-11 cursor-pointer bg-transparent px-3 text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="install-plus-tard"
          @click="plusTard"
        >
          Plus tard
        </button>
        <button
          type="button"
          class="min-h-11 cursor-pointer bg-transparent px-3 text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="install-refuser"
          @click="refuser"
        >
          Non merci
        </button>
      </div>
    </div>
  </aside>
</template>
