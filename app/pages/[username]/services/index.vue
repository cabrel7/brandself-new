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
}

const route = useRoute()
const username = route.params.username as string

const { data: services, error, pending } = await useAsyncData<ServicePublique[] | null>(
  'services-publique',
  () => $fetch<ServicePublique[] | null>(`/api/public/${username}/services`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !services.value) {
  throw createError({ statusCode: 404, statusMessage: 'Aucun service trouvé.' })
}

const servicesPublique = services.value || []

definePageMeta({
  title: `Services`,
})
</script>

<template>
  <div class="services-publique">
    <nav class="services-publique__nav">
      <NuxtLink to="/">Retour à la vitrine</NuxtLink>
    </nav>

    <h1 class="services-publique__titre">Nos services</h1>

    <div v-if="servicesPublique.length === 0" class="services-publique__vide">
      <p>Aucun service pour le moment.</p>
    </div>

    <div v-else class="services-publique__grille">
      <div
        v-for="service in servicesPublique"
        :key="service.id"
        class="services-publique__carte"
      >
        <div class="services-publique__carte__en-tete">
          <BsVariant :valeur="service.type" />
        </div>
        <h3 class="services-publique__carte__titre">{{ service.titre }}</h3>
        <p v-if="service.description" class="services-publique__carte__description">
          {{ service.description }}
        </p>
        <div class="services-publique__carte__meta">
          <span>{{ service.dureeMin }} min</span>
          <span v-if="service.prixMontant !== undefined && service.prixDevise"
            >{{ service.prixMontant }} {{ service.prixDevise }}</span
          >
          <span v-else-if="service.tarif === 'gratuit'">Gratuit</span>
          <span v-else-if="service.tarif === 'devis'">Sur devis</span>
        </div>
        <NuxtLink :to="`/${username}/services/${service.slug}`" class="services-publique__carte__lien">
          Voir le détail
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.services-publique {
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.services-publique__nav {
  margin-bottom: 1.5rem;
}
.services-publique__nav a {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
}
.services-publique__titre {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1.5rem 0;
}
.services-publique__vide {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--texte-secondaire);
}
.services-publique__grille {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 64rem) {
  .services-publique__grille {
    grid-template-columns: repeat(2, 1fr);
  }
}
.services-publique__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.services-publique__carte__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.services-publique__carte__titre {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.services-publique__carte__description {
  font-size: 0.9rem;
  color: var(--texte-secondaire);
  margin: 0;
}
.services-publique__carte__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin-bottom: 0.75rem;
}
.services-publique__carte__lien {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
}
.services-publique__carte__lien:hover {
  text-decoration: underline;
}
</style>
