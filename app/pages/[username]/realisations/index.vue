<script setup lang="ts">
interface RealisationPublique {
  id: string
  slug: string
  titre: string
  description?: string
  imageMediaId?: string
  annee?: number
  lieu?: string
  role?: string
  lien?: string
}

const route = useRoute()
const username = route.params.username as string

const { data: realisations, error, pending } = await useAsyncData<RealisationPublique[] | null>(
  'realisations-publique',
  () => $fetch<RealisationPublique[] | null>(`/api/public/${username}/realisations`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !realisations.value) {
  throw createError({ statusCode: 404, statusMessage: 'Aucune réalisation trouvée.' })
}

const realisationsPublique = realisations.value || []

definePageMeta({
  title: 'Réalisations',
})
</script>

<template>
  <div class="realisations-publique">
    <nav class="realisations-publique__nav">
      <NuxtLink to="/">Retour à la vitrine</NuxtLink>
    </nav>

    <h1 class="realisations-publique__titre">Nos réalisations</h1>

    <div v-if="realisationsPublique.length === 0" class="realisations-publique__vide">
      <p>Aucune réalisation pour le moment.</p>
    </div>

    <div v-else class="realisations-publique__grille">
      <div
        v-for="realisation in realisationsPublique"
        :key="realisation.id"
        class="realisations-publique__carte"
      >
        <div class="realisations-publique__carte__en-tete">
          <BsBadge :label="realisation.annee || 'Sans année'" />
        </div>
        <h3 class="realisations-publique__carte__titre">{{ realisation.titre }}</h3>
        <p v-if="realisation.description" class="realisations-publique__carte__description">
          {{ realisation.description }}
        </p>
        <div class="realisations-publique__carte__meta">
          <span v-if="realisation.lieu">{{ realisation.lieu }}</span>
          <span v-if="realisation.role">{{ realisation.role }}</span>
        </div>
        <NuxtLink
          :to="`/${username}/realisations/${realisation.slug}`"
          class="realisations-publique__carte__lien"
        >
          Voir le détail
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.realisations-publique {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.realisations-publique__nav {
  margin-bottom: 1.5rem;
}
.realisations-publique__nav a {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
.realisations-publique__titre {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1.5rem 0;
}
.realisations-publique__vide {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--texte-secondaire);
}
.realisations-publique__grille {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 64rem) {
  .realisations-publique__grille {
    grid-template-columns: repeat(2, 1fr);
  }
}
.realisations-publique__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.realisations-publique__carte__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.realisations-publique__carte__titre {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.realisations-publique__carte__description {
  font-size: 0.9rem;
  color: var(--texte-secondaire);
  margin: 0;
}
.realisations-publique__carte__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin-bottom: 0.75rem;
}
.realisations-publique__carte__lien {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
}
.realisations-publique__carte__lien:hover {
  text-decoration: underline;
}
</style>
