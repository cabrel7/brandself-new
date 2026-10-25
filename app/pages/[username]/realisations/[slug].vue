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
const slug = route.params.slug as string

const { data: realisation, error, pending } = await useAsyncData<RealisationPublique | null>(
  'realisation-publique',
  () => $fetch<RealisationPublique | null>(`/api/public/${username}/realisations/${slug}`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !realisation.value) {
  throw createError({ statusCode: 404, statusMessage: 'Réalisation introuvable.' })
}

const r = realisation.value
</script>

<template>
  <div class="realisation-publique">
    <nav class="realisation-publique__nav">
      <NuxtLink to="/" class="realisation-publique__retour">← Retour à la vitrine</NuxtLink>
    </nav>

    <article class="realisation-publique__carte">
      <div class="realisation-publique__en-tete">
        <BsBadge :label="r.annee || 'Sans année'" />
        <h1 class="realisation-publique__titre">{{ r.titre }}</h1>
      </div>

      <p v-if="r.description" class="realisation-publique__description">{{ r.description }}</p>

      <div class="realisation-publique__meta">
        <span v-if="r.lieu">{{ r.lieu }}</span>
        <span v-if="r.role">{{ r.role }}</span>
        <span v-if="r.lien">{{ r.lien }}</span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.realisation-publique {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.realisation-publique__nav {
  margin-bottom: 1.5rem;
}
.realisation-publique__retour {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
.realisation-publique__retour:hover {
  text-decoration: underline;
}
.realisation-publique__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.5rem;
}
.realisation-publique__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.realisation-publique__titre {
  font-family: var(--font-titre);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}
.realisation-publique__description {
  font-size: 1rem;
  color: var(--encre);
  line-height: 1.6;
  margin: 1rem 0;
}
.realisation-publique__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--texte-secondaire);
}
</style>
