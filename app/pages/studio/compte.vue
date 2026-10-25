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

async function deconnecter() {
  await $fetch('/api/auth/sign-out', { method: 'POST' })
  await navigateTo('/connexion')
}
</script>

<template>
  <div class="studio">
    <BsTopNav actif="compte" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <h1>Compte</h1>
        <p class="studio__sous-titre">Vos informations de compte et préférences.</p>
      </section>

      <section v-if="moi" class="studio__carte">
        <h2>Informations</h2>
        <dl class="studio__liste">
          <dt>Nom</dt>
          <dd>{{ moi.nom }}</dd>
          <dt>Email</dt>
          <dd>{{ moi.email ?? '—' }}</dd>
          <dt>Téléphone</dt>
          <dd>{{ moi.telephone ?? '—' }}</dd>
          <dt>Langue</dt>
          <dd>{{ moi.locale }}</dd>
          <dt>Devise</dt>
          <dd>{{ moi.devise }}</dd>
          <dt>Fuseau horaire</dt>
          <dd>{{ moi.fuseau }}</dd>
        </dl>
      </section>

      <section class="studio__carte">
        <h2>Abonnement (provisoire)</h2>
        <p class="studio__texte">Plan gratuit — réservation limitée à 10 par mois.</p>
      </section>

      <section class="studio__actions">
        <BsButton variant="principal" @click="deconnecter">Déconnexion</BsButton>
      </section>
    </main>

    <BsBottomNav actif="compte" />
  </div>
</template>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--fond);
}
.studio__contenu {
  flex: 1;
  padding: 1.5rem;
  max-width: 28rem;
  margin: 0 auto;
}
.studio__en-tete {
  margin-bottom: 2rem;
}
.studio__en-tete h1 {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.studio__sous-titre {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  margin: 0;
}
.studio__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}
.studio__carte h2 {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1rem 0;
}
.studio__texte {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  margin: 0 0 1rem 0;
}
.studio__liste {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 1rem;
  margin: 0;
}
.studio__liste dt {
  color: var(--texte-secondaire);
  font-size: 0.85rem;
}
.studio__liste dd {
  margin: 0;
  font-size: 1rem;
  color: var(--encre);
}
.studio__actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
</style>
