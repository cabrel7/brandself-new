<script setup lang="ts">
import { useRouter } from '#app'

const router = useRouter()

const titre = ref('')
const prenom = ref('')
const nom = ref('')
const metier = ref('')
const username = ref('')
const chargement = ref(false)
const erreur = ref('')

async function creerVitrine() {
  erreur.value = ''
  chargement.value = true
  try {
    await $fetch('/api/studio/vitrine', {
      method: 'POST',
      body: { titre, prenom, nom, metier, username: username.value.trim().toLowerCase() },
    })
    await router.push('/studio')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Une erreur est survenue lors de la création de votre vitrine.'
    erreur.value = message
  } finally {
    chargement.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Créer votre vitrine</h1>
    <p class="texte">
      Quelques informations pour débuter. Vous pourrez les modifier plus tard depuis le studio.
    </p>

    <form class="formulaire" @submit.prevent="creerVitrine">
      <BsField label="Titre de votre vitrine" :error="erreur">
        <input v-model="titre" type="text" placeholder="Mon activité" required>
      </BsField>

      <BsField label="Prénom">
        <input v-model="prenom" type="text" placeholder="Jean" required>
      </BsField>

      <BsField label="Nom">
        <input v-model="nom" type="text" placeholder="Dupont" required>
      </BsField>

      <BsField label="Métier">
        <input v-model="metier" type="text" placeholder="Cardiologue" required>
      </BsField>

      <BsField label="Adresse de votre vitrine">
        <span class="username-prefix">brandself.io/</span>
        <input v-model="username" type="text" placeholder="dr-cabrel" required>
      </BsField>

      <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

      <BsButton variant="principal" :disabled="chargement" type="submit">
        {{ chargement ? 'Création en cours…' : 'Créer ma vitrine' }}
      </BsButton>
    </form>
  </main>
</template>

<style scoped>
.page {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
h1 {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.texte {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  line-height: 1.5;
}
.formulaire {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.username-prefix {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translatey(-50%);
  color: var(--texte-secondaire);
  font-size: 0.85rem;
}
</style>
