<script setup lang="ts">
import { useRouter } from '#app'

const router = useRouter()

const titre = ref('')
const description = ref('')
const imageMediaId = ref('')
const annee = ref('')
const lieu = ref('')
const role = ref('')
const lien = ref('')
const enVedette = ref(false)

const chargement = ref(false)
const erreur = ref('')

async function creerRealisation() {
  erreur.value = ''
  chargement.value = true
  try {
    const body: Record<string, unknown> = {
      titre,
      description,
      imageMediaId,
      annee: annee.value ? parseInt(annee.value, 10) : undefined,
      lieu,
      role,
      lien,
      enVedette: enVedette.value,
    }

    const reponse = await $fetch<{ realisation: { slug: string } }>('/api/studio/realisations', {
      method: 'POST',
      body,
    })

    await router.push(`/studio/realisations/${reponse.realisation.slug}`)
  } catch (err: unknown) {
    erreur.value = err instanceof Error ? err.message : 'Une erreur est survenue.'
  } finally {
    chargement.value = false
  }
}
</script>

<template>
  <div class="studio">
    <BsTopNav actif="realisations" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <h1>Nouvelle réalisation</h1>
        <p class="studio__sous-titre">Ajoutez une réalisation à votre vitrine.</p>
      </section>

      <section class="studio__carte">
        <h2>Détails de la réalisation</h2>

        <BsField label="Titre" required>
          <input v-model="titre" type="text" required />
        </BsField>

        <BsField label="Description">
          <textarea v-model="description" placeholder="Décrivez votre réalisation…" rows="3" />
        </BsField>

        <BsField label="Image (ID média)">
          <input v-model="imageMediaId" type="text" placeholder="ID du média" />
        </BsField>

        <BsField label="Année">
          <input v-model="annee" type="number" min="1900" max="2100" placeholder="2024" />
        </BsField>

        <BsField label="Lieu">
          <input v-model="lieu" type="text" placeholder="Douala, Cameroun" />
        </BsField>

        <BsField label="Rôle">
          <input v-model="role" type="text" placeholder="Cardiologue" />
        </BsField>

        <BsField label="Lien externe">
          <input v-model="lien" type="url" placeholder="https://example.com" />
        </BsField>

        <div class="studio__interrupteurs">
          <label class="interrupteur-label">
            <BsSwitch v-model="enVedette" label="En vedette sur l'accueil" />
          </label>
        </div>

        <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

        <div class="studio__actions">
          <BsButton variant="contour" to="/studio/realisations">Annuler</BsButton>
          <BsButton variant="principal" :disabled="chargement" @click="creerRealisation">
            {{ chargement ? 'Création en cours…' : 'Créer la réalisation' }}
          </BsButton>
        </div>
      </section>
    </main>

    <BsBottomNav actif="realisations" />
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
}
.studio__carte h2 {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1rem 0;
}
.studio__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}
.erreur {
  color: var(--erreur);
  font-size: 0.9rem;
  margin-bottom: 1rem;
}
.studio__interrupteurs {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bordure);
}
.interrupteur-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--encre);
  cursor: pointer;
}
textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--bordure);
  border-radius: 0.75rem;
  background-color: var(--surface);
  font-family: var(--font-texte);
  font-size: 1rem;
  resize: vertical;
}
</style>
