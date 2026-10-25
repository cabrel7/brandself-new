<script setup lang="ts">
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

const temoignages = ref<Temoignage[]>([])
const chargement = ref(true)
const erreur = ref('')

async function chargerTemoignages() {
  chargement.value = true
  try {
    const reponse = await $fetch<{ temoignages: Temoignage[] }>('/api/studio/temoignages')
    temoignages.value = reponse.temoignages
  } catch {
    erreur.value = 'Impossible de charger les témoignages.'
  } finally {
    chargement.value = false
  }
}

async function supprimerTemoignage(slug: string) {
  if (!confirm('Supprimer ce témoignage ?')) return
  try {
    const reponse = await fetch(`/api/studio/temoignages/${slug}`, { method: 'DELETE' })
    if (!reponse.ok) throw new Error('Suppression refusée')
    await chargerTemoignages()
  } catch {
    erreur.value = 'Impossible de supprimer le témoignage.'
  }
}

onMounted(() => {
  chargerTemoignages()
})
</script>

<template>
  <div class="studio">
    <BsTopNav actif="temoignages" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <div class="studio__en-tete__groupe">
          <h1>Témoignages</h1>
          <BsButton variant="principal" to="/studio/temoignages/nouveau">Ajouter un témoignage</BsButton>
        </div>
        <p class="studio__sous-titre">
          {{ temoignages.length }} témoignage{{ temoignages.length > 1 ? 's' : '' }}
          · {{ temoignages.filter((t) => t.enVedette).length }} en vedette
        </p>
      </section>

      <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

      <div v-if="temoignages.length > 0" class="temoignages__grille">
        <div v-for="temoignage in temoignages" :key="temoignage.id" class="temoignages__carte">
          <div class="temoignages__carte__en-tete">
            <BsBadge :label="temoignage.fonction || 'Sans fonction'" />
            <BsBadge v-if="temoignage.enVedette" variant="vedette">En vedette</BsBadge>
          </div>
          <h3 class="temoignages__carte__titre">{{ temoignage.auteur }}</h3>
          <p class="temoignages__carte__texte">{{ temoignage.texte }}</p>
          <div class="temoignages__carte__actions">
            <BsButton variant="lien" :to="`/studio/temoignages/${temoignage.slug}`">Modifier</BsButton>
            <BsButton variant="lien" @click="supprimerTemoignage(temoignage.slug)">Supprimer</BsButton>
          </div>
          <div class="temoignages__carte__interrupteurs">
            <label class="interrupteur-label">
              <BsSwitch v-model="temoignage.enVedette" label="En vedette" />
            </label>
            <label class="interrupteur-label">
              <BsSwitch v-model="temoignage.actif" label="Visible sur la vitrine" />
            </label>
          </div>
        </div>
      </div>

      <div v-else class="temoignages__vide">
        <p>Aucun témoignage pour le moment.</p>
        <BsButton variant="principal" to="/studio/temoignages/nouveau">Créer un premier témoignage</BsButton>
      </div>
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
.temoignages__grille {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 64rem) {
  .temoignages__grille {
    grid-template-columns: repeat(2, 1fr);
  }
}
.temoignages__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.temoignages__carte__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.temoignages__carte__titre {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.temoignages__carte__texte {
  font-size: 0.9rem;
  color: var(--encre);
  line-height: 1.5;
  margin: 0;
}
.temoignages__carte__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}
.temoignages__carte__interrupteurs {
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
.temoignages__vide {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--texte-secondaire);
}
</style>
