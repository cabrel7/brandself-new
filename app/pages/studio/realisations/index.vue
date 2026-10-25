<script setup lang="ts">
interface Realisation {
  id: string
  vitrineId: string
  slug: string
  titre: string
  description?: string
  imageMediaId?: string
  annee?: number
  lieu?: string
  role?: string
  lien?: string
  enVedette: boolean
  ordre: number
  actif: boolean
}

const realisations = ref<Realisation[]>([])
const chargement = ref(true)
const erreur = ref('')

async function chargerRealisations() {
  chargement.value = true
  try {
    const reponse = await $fetch<{ realisations: Realisation[] }>('/api/studio/realisations')
    realisations.value = reponse.realisations
  } catch {
    erreur.value = 'Impossible de charger les réalisations.'
  } finally {
    chargement.value = false
  }
}

async function supprimerRealisation(slug: string) {
  if (!confirm('Supprimer cette réalisation ?')) return
  try {
    const reponse = await fetch(`/api/studio/realisations/${slug}`, { method: 'DELETE' })
    if (!reponse.ok) throw new Error('Suppression refusée')
    await chargerRealisations()
  } catch {
    erreur.value = 'Impossible de supprimer la réalisation.'
  }
}

onMounted(() => {
  chargerRealisations()
})
</script>

<template>
  <div class="studio">
    <BsTopNav actif="realisations" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <div class="studio__en-tete__groupe">
          <h1>Réalisations</h1>
          <BsButton variant="principal" to="/studio/realisations/nouveau">Ajouter une réalisation</BsButton>
        </div>
        <p class="studio__sous-titre">
          {{ realisations.length }} réalisation{{ realisations.length > 1 ? 's' : '' }}
          · {{ realisations.filter((r) => r.enVedette).length }} en vedette
        </p>
      </section>

      <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

      <div v-if="realisations.length > 0" class="realisations__grille">
        <div v-for="realisation in realisations" :key="realisation.id" class="realisations__carte">
          <div class="realisations__carte__en-tete">
            <BsBadge :label="realisation.annee || 'Sans année'" />
            <BsBadge v-if="realisation.enVedette" variant="vedette">En vedette</BsBadge>
          </div>
          <h3 class="realisations__carte__titre">{{ realisation.titre }}</h3>
          <p v-if="realisation.description" class="realisations__carte__description">
            {{ realisation.description }}
          </p>
          <div class="realisations__carte__meta">
            <span v-if="realisation.lieu">{{ realisation.lieu }}</span>
            <span v-if="realisation.role">{{ realisation.role }}</span>
          </div>
          <div class="realisations__carte__actions">
            <BsButton variant="lien" :to="`/studio/realisations/${realisation.slug}`">Modifier</BsButton>
            <BsButton variant="lien" @click="supprimerRealisation(realisation.slug)">Supprimer</BsButton>
          </div>
          <div class="realisations__carte__interrupteurs">
            <label class="interrupteur-label">
              <BsSwitch v-model="realisation.enVedette" label="En vedette" />
            </label>
            <label class="interrupteur-label">
              <BsSwitch v-model="realisation.actif" label="Visible sur la vitrine" />
            </label>
          </div>
        </div>
      </div>

      <div v-else class="realisations__vide">
        <p>Aucune réalisation pour le moment.</p>
        <BsButton variant="principal" to="/studio/realisations/nouveau">Créer une première réalisation</BsButton>
      </div>
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
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.studio__en-tete__groupe {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.studio__en-tete h1 {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}
.studio__sous-titre {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  margin: 0;
}
.erreur {
  color: var(--erreur);
  font-size: 0.9rem;
  margin-bottom: 1rem;
}
.realisation__grille,
.realisation__grille {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 64rem) {
  .realisation__grille {
    grid-template-columns: repeat(2, 1fr);
  }
}
.realisation__carte,
.realisation__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.realisation__carte__en-tete,
.realisation__carte__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.realisation__carte__titre {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.realisation__carte__description {
  font-size: 0.9rem;
  color: var(--texte-secondaire);
  margin: 0;
}
.realisation__carte__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin-bottom: 0.75rem;
}
.realisation__carte__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}
.realisation__carte__interrupteurs {
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
.realisation__vide {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--texte-secondaire);
}
</style>
