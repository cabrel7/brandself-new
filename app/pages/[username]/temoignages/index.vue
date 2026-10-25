<script setup lang="ts">
interface TemoignagePublique {
  id: string
  slug: string
  auteur: string
  fonction?: string
  texte: string
}

const route = useRoute()
const username = route.params.username as string

const { data: temoignages, error, pending } = await useAsyncData<TemoignagePublique[] | null>(
  'temoignages-publique',
  () => $fetch<TemoignagePublique[] | null>(`/api/public/${username}/temoignages`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !temoignages.value) {
  throw createError({ statusCode: 404, statusMessage: 'Aucun témoignage trouvé.' })
}

const temoignagesPublique = temoignages.value || []

definePageMeta({
  title: 'Témoignages',
})
</script>

<template>
  <div class="temoignages-publique">
    <nav class="temoignages-publique__nav">
      <NuxtLink to="/">Retour à la vitrine</NuxtLink>
    </nav>

    <h1 class="temoignages-publique__titre">Nos témoignages</h1>

    <div v-if="temoignagesPublique.length === 0" class="temoignages-publique__vide">
      <p>Aucun témoignage pour le moment.</p>
    </div>

    <div v-else class="temoignages-publique__grille">
      <div
        v-for="temoignage in temoignagesPublique"
        :key="temoignage.id"
        class="temoignages-publique__carte"
      >
        <h3 class="temoignages-publique__carte__auteur">{{ temoignage.auteur }}</h3>
        <span v-if="temoignage.fonction" class="temoignages-publique__carte__fonction"
          >{{ temoignage.fonction }}</span
        >
        <p class="temoignages-publique__carte__texte">{{ temoignage.texte }}</p>
        <NuxtLink
          :to="`/${username}/temoignages/${temoignage.slug}`"
          class="temoignages-publique__carte__lien"
        >
          Voir le détail
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.temoignages-publique {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.temoignages-publique__nav {
  margin-bottom: 1.5rem;
}
.temoignages-publique__nav a {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
.temoignages-publique__titre {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1.5rem 0;
}
.temoignages-publique__vide {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--texte-secondaire);
}
.temoignages-publique__grille {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 64rem) {
  .temoignages-publique__grille {
    grid-template-columns: repeat(2, 1fr);
  }
}
.temoignages-publique__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.temoignages-publique__carte__auteur {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}
.temoignages-publique__carte__fonction {
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin: 0 0 0.5rem 0;
}
.temoignages-publique__carte__texte {
  font-size: 0.95rem;
  color: var(--encre);
  line-height: 1.6;
  margin: 0;
}
.temoignages-publique__carte__lien {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
  margin-top: auto;
}
.temoignages-publique__carte__lien:hover {
  text-decoration: underline;
}
</style>
