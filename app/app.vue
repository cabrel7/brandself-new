<script setup lang="ts">
import { fr } from '@nuxt/ui/locale'
import { ref, onMounted } from 'vue'

const nouvelleVersion = ref(false)

function activerNouvelleVersion(): void {
  nouvelleVersion.value = false
  window.location.reload()
}

onMounted(() => {
  // Détection d'une nouvelle version du service worker (maquette « PWA · Mise à jour »).
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.ready.then((registration) => {
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing
      if (!installingWorker) return
      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'activated' && navigator.serviceWorker.controller) {
          nouvelleVersion.value = true
        }
      })
    })
  })
})
</script>

<template>
  <UApp :locale="fr">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <div v-if="nouvelleVersion" role="status" data-message-ouvert class="fixed inset-x-0 top-0 z-50 p-3">
        <div class="mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-(--rayon) bg-accent-doux px-4 py-3 shadow-lg">
          <p class="m-0 min-w-0 text-base font-semibold text-encre">Une nouvelle version est disponible.</p>
          <button
            type="button"
            class="min-h-11 shrink-0 cursor-pointer rounded-xl bg-accent px-5 text-base font-semibold text-sur-accent transition-opacity hover:opacity-90"
            @click="activerNouvelleVersion"
          >
            Actualiser
          </button>
        </div>
      </div>
      <NuxtPage />
      <InstallPrompt />
    </NuxtLayout>
  </UApp>
</template>
