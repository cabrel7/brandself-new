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
const slug = route.params.slug as string

const { data: temoignage, error, pending } = await useAsyncData<TemoignagePublique | null>(
  'temoignage-publique',
  () => $fetch<TemoignagePublique | null>(`/api/public/${username}/temoignages/${slug}`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !temoignage.value) {
  throw createError({ statusCode: 404, statusMessage: 'Témoignage introuvable.' })
}

const t = temoignage.value
</script>

<template>
  <div class="temoignage-publique">
    <nav class="temoignage-publique__nav">
      <NuxtLink to="/" class="temoignage-publique__retour">← Retour à la vitrine</NuxtLink>
    </nav>

    <article class="temoignage-publique__carte">
      <div class="temoignage-publique__en-tete">
        <h1 class="temoignage-publique__auteur">{{ t.auteur }}</h1>
        <span v-if="t.fonction" class="temoignage-publique__fonction">{{ t.fonction }}</span>
      </div>

      <p class="temoignage-publique__texte">{{ t.texte }}</p>
    </article>
  </div>
</template>

<style scoped>
.temoignage-publique {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.temoignage-publique__nav {
  margin-bottom: 1.5rem;
}
.temoignage-publique__retour {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
.temoignage-publique__retour:hover {
  text-decoration: underline;
}
.temoignage-publique__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.5rem;
}
.temoignage-publique__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.temoignage-publique__auteur {
  font-family: var(--font-titre);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}
.temoignage-publique__fonction {
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin: 0;
}
.temoignage-publique__texte {
  font-size: 1rem;
  color: var(--encre);
  line-height: 1.6;
  margin: 1rem 0;
}
</style>
