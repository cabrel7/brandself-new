<script setup lang="ts">
interface ServicePublique {
  id: string
  slug: string
  titre: string
  description?: string
  type: string
  dureeMin: number
  tarif: string
  prixMontant?: number
  prixDevise?: string
  reservable: boolean
}

const route = useRoute()
const username = route.params.username as string
const slug = route.params.slug as string

const { data: service, error, pending } = await useAsyncData<ServicePublique | null>(
  'service-publique',
  () => $fetch<ServicePublique | null>(`/api/public/${username}/services/${slug}`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !service.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service introuvable.' })
}

const s = service.value
</script>

<template>
  <div class="service-publique">
    <nav class="service-publique__nav">
      <NuxtLink to="/" class="service-publique__retour">← Retour à la vitrine</NuxtLink>
    </nav>

    <article class="service-publique__carte">
      <div class="service-publique__en-tete">
        <BsVariant :valeur="s.type" />
        <h1 class="service-publique__titre">{{ s.titre }}</h1>
      </div>

      <p v-if="s.description" class="service-publique__description">{{ s.description }}</p>

      <div class="service-publique__meta">
        <span>{{ s.dureeMin }} min</span>
        <span v-if="s.prixMontant !== undefined && s.prixDevise"
          >{{ s.prixMontant }} {{ s.prixDevise }}</span
        >
        <span v-else-if="s.tarif === 'gratuit'">Gratuit</span>
        <span v-else-if="s.tarif === 'devis'">Sur devis</span>
      </div>

      <div class="service-publique__actions">
        <BsButton
          variant="principal"
          :disabled="!s.reservable"
          >Réserver ce service</BsButton
        >
      </div>
    </article>
  </div>
</template>

<style scoped>
.service-publique {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.service-publique__nav {
  margin-bottom: 1.5rem;
}
.service-publique__retour {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
.service-publique__retour:hover {
  text-decoration: underline;
}
.service-publique__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.5rem;
}
.service-publique__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.service-publique__titre {
  font-family: var(--font-titre);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}
.service-publique__description {
  font-size: 1rem;
  color: var(--encre);
  line-height: 1.6;
  margin: 1rem 0;
}
.service-publique__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin-bottom: 1.5rem;
}
.service-publique__actions {
  display: flex;
  gap: 0.75rem;
}
</style>
