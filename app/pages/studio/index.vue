<script setup lang="ts">
interface Moi {
  id: string
  email: string | null
  telephone: string | null
  nom: string
  locale: string
  devise: string
  fuseau: string
  aUneVitrine: boolean
}

const authClient = useAuthClient()
const moi = ref<Moi | null>(null)
const chargement = ref(true)

onMounted(async () => {
  try {
    moi.value = await $fetch<Moi>('/api/studio/moi')
  } finally {
    chargement.value = false
  }
})

async function deconnecter(): Promise<void> {
  try {
    if (authClient) {
      await authClient.signOut()
    }
  } finally {
    await navigateTo('/connexion')
  }
}
</script>

<template>
  <main class="page">
    <h1>Studio</h1>
    <p class="texte">Version provisoire — la coque complète du studio arrive au sprint suivant.</p>

    <section v-if="!chargement && moi" class="carte">
      <h2>Votre compte</h2>
      <dl>
        <dt>Email</dt>
        <dd>{{ moi.email ?? '—' }}</dd>
        <dt>Téléphone</dt>
        <dd>{{ moi.telephone ?? '—' }}</dd>
        <dt>Devise</dt>
        <dd>{{ moi.devise }}</dd>
        <dt>Fuseau</dt>
        <dd>{{ moi.fuseau }}</dd>
      </dl>
    </section>

    <button type="button" class="bouton-deconnexion" @click="deconnecter">
      Déconnexion
    </button>
  </main>
</template>

<style scoped>
.page {
  max-width: 26rem;
  margin: 0 auto;
  padding: 3rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

h1 {
  font-size: 2rem;
  font-weight: 600;
}

h2 {
  font-size: 1.2rem;
}

.texte {
  color: var(--texte-secondaire);
  line-height: 1.5;
}

.carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.carte dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 1rem;
  margin: 0;
}

.carte dt {
  color: var(--texte-secondaire);
  font-size: 0.85rem;
}

.carte dd {
  margin: 0;
}

.bouton-deconnexion {
  min-height: 3rem;
  padding: 0 1.25rem;
  border-radius: 0.75rem;
  border: 1px solid var(--bordure);
  background: none;
  font-family: var(--font-texte);
  font-size: 1rem;
  cursor: pointer;
  align-self: flex-start;
}
</style>
