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

const moi = ref<Moi | null>(null)
const chargement = ref(true)

onMounted(async () => {
  try {
    moi.value = await $fetch<Moi>('/api/studio/moi')
  } finally {
    chargement.value = false
  }
})
</script>

<template>
  <main class="page">
    <h1>Bienvenue.</h1>
    <p v-if="chargement" class="texte">Un instant, nous préparons votre espace…</p>
    <template v-else>
      <p class="texte">
        Vous êtes connecté
        <span v-if="moi?.email">avec l'adresse {{ moi.email }}</span>
        <span v-else-if="moi?.telephone">avec le numéro {{ moi.telephone }}</span>.
      </p>
      <p class="texte">
        L'inscription guidée arrive avec un prochain sprint. En attendant, découvrez le studio.
      </p>
    </template>
    <NuxtLink class="bouton" to="/studio">Ouvrir le studio</NuxtLink>
  </main>
</template>

<style scoped>
.page {
  max-width: 26rem;
  margin: 0 auto;
  padding: 3rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1 {
  font-size: 2rem;
  font-weight: 600;
}

.texte {
  color: var(--texte-secondaire);
  line-height: 1.5;
}

.bouton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3rem;
  padding: 0 1.25rem;
  border-radius: 0.75rem;
  background-color: var(--accent);
  color: #FFFFFF;
  font-weight: 500;
  text-decoration: none;
  align-self: flex-start;
}
</style>
