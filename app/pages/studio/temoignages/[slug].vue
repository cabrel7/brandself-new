<script setup lang="ts">
import { useRouter } from '#app'

const router = useRouter()

const route = useRoute()
const slug = route.params.slug as string

interface Temoignage {
  id: string
  vitrineId: string
  slug: string
  auteur: string
  fonction?: string
  texte: string
  enVedette: boolean
  ordre: number
  actif: boolean
}

const temoignage = ref<Temoignage | null>(null)
const chargement = ref(true)
const erreur = ref('')

const auteur = ref('')
const fonction = ref('')
const texte = ref('')
const enVedette = ref(false)

async function chargerTemoignage() {
  chargement.value = true
  try {
    const reponse = await $fetch<{ temoignage: Temoignage }>(`/api/studio/temoignages/${slug}`)
    temoignage.value = reponse.temoignage
    auteur.value = reponse.temoignage.auteur
    fonction.value = reponse.temoignage.fonction || ''
    texte.value = reponse.temoignage.texte
    enVedette.value = reponse.temoignage.enVedette
  } catch {
    erreur.value = 'Impossible de charger le témoignage.'
  } finally {
    chargement.value = false
  }
}

async function modifierTemoignage() {
  erreur.value = ''
  chargement.value = true
  try {
    const body: Record<string, unknown> = {
      auteur,
      fonction,
      texte,
      enVedette: enVedette.value,
    }

    const reponse = await fetch(`/api/studio/temoignages/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!reponse.ok) throw new Error('Modification refusée')

    await router.push('/studio/temoignages')
  } catch (err: unknown) {
    erreur.value = err instanceof Error ? err.message : 'Une erreur est survenue.'
  } finally {
    chargement.value = false
  }
}

onMounted(() => {
  chargerTemoignage()
})
</script>

<template>
  <div class="studio">
    <BsTopNav actif="temoignages" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <h1>Modifier le témoignage</h1>
        <p class="studio__sous-titre">Modifiez les informations de votre témoignage.</p>
      </section>

      <section class="studio__carte">
        <h2>Détails du témoignage</h2>

        <BsField label="Auteur" required>
          <input v-model="auteur" type="text" required />
        </BsField>

        <BsField label="Fonction">
          <input v-model="fonction" type="text" placeholder="Directeur, Cliente, etc." />
        </BsField>

        <BsField label="Texte" required>
          <textarea v-model="texte" placeholder="Racontez votre expérience…" rows="4" />
        </BsField>

        <div class="studio__interrupteurs">
          <label class="interrupteur-label">
            <BsSwitch v-model="enVedette" label="En vedette sur l'accueil" />
          </label>
        </div>

        <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

        <div class="studio__actions">
          <BsButton variant="contour" to="/studio/temoignages">Annuler</BsButton>
          <BsButton variant="principal" :disabled="chargement" @click="modifierTemoignage">
            {{ chargement ? 'Enregistrement…' : 'Enregistrer les modifications' }}
          </BsButton>
        </div>
      </section>
    </main>

    <BsBottomNav actif="temoignages" />
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
