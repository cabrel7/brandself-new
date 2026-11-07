<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
const route = useRoute()
const {
  dejaInstalle,
  iosSafari,
  origine,
  deviceType,
  peutAfficherPrompt,
  afficherPrompt,
  refuserPrompt,
  installer,
} = usePwaInstall()
const { enregistrerEvenement } = usePwaStats()

const visible = ref(false)
const estMobile = computed(() => deviceType === 'mobile')

const estStudio = route.path.startsWith('/studio/')
const estMarketing = route.path === '/' || route.path === '/tarifs'

onMounted(() => {
  if (dejaInstalle) return
  if ((estStudio || estMarketing) && peutAfficherPrompt()) {
    afficherPrompt()
    enregistrerEvenement('proposee', origine, deviceType)
    visible.value = true
  }
})

function fermer(): void {
  visible.value = false
}

async function handleInstall(): Promise<void> {
  visible.value = false
  await installer()
  enregistrerEvenement('installee', origine, deviceType)
}

async function handleRefuser(): Promise<void> {
  visible.value = false
  refuserPrompt()
  enregistrerEvenement('refusee', origine, deviceType)
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') fermer()
}

const doitAfficher = computed(
  () => visible.value && !dejaInstalle && (estStudio || estMarketing) && peutAfficherPrompt()
)
</script>

<template>
  <div
    v-if="doitAfficher"
    role="dialog"
    aria-modal="true"
    aria-label="Installer jesuis.pro"
    @keydown.escape="fermer"
    @keydown="handleKeyDown"
  >
    <!-- Overlay -->
    <div class="fixed inset-0 z-50" @click="fermer" />

    <!-- Mobile bottom sheet -->
    <div v-if="estMobile && !iosSafari" class="fixed bottom-0 left-0 right-0 z-50 p-4">
      <div class="bg-white rounded-t-2xl p-6 shadow-2xl">
        <h2 class="font-bold text-lg mb-2">Installez jesuis.pro</h2>
        <p class="text-sm text-gray-600 mb-6">
          Retrouvez votre studio en un geste, sans retenir l'adresse.
        </p>
        <div class="flex gap-2">
          <button
            @click="handleInstall"
            class="flex-1 bg-black text-white py-3 rounded-lg font-medium"
          >
            Installer
          </button>
          <button
            @click="handleRefuser"
            class="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>

    <!-- Desktop card -->
    <div
      v-else-if="!estMobile && !iosSafari"
      class="fixed bottom-4 right-4 z-50 w-64 p-6 bg-white rounded-xl shadow-2xl border"
    >
      <h2 class="font-bold text-lg mb-2">Installez jesuis.pro</h2>
      <p class="text-sm text-gray-600 mb-6">
        Retrouvez votre studio en un geste, sans retenir l'adresse.
      </p>
      <div class="flex gap-2">
        <button
          @click="handleInstall"
          class="flex-1 bg-black text-white py-3 rounded-lg font-medium"
        >
          Installer
        </button>
        <button
          @click="handleRefuser"
          class="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium"
        >
          Plus tard
        </button>
      </div>
    </div>

    <!-- iOS instructions -->
    <div v-if="iosSafari" class="fixed bottom-4 left-4 right-4 z-50 p-4 max-w-md">
      <div class="bg-white rounded-xl p-6 shadow-2xl border">
        <h2 class="font-bold text-lg mb-2">Installer jesuis.pro</h2>
        <p class="text-sm text-gray-600 mb-4">
          Touchez
          <i-ph-share class="inline" />
          Partager, puis
          <b>Ajouter à l'écran d'accueil</b>.
        </p>
        <button
          @click="fermer"
          class="w-full border border-gray-300 text-gray-700 py-3 rounded-lg font-medium"
        >
          Fermer
        </button>
      </div>
    </div>
  </div>
</template>
