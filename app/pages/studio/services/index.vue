<script setup lang="ts">
interface Service {
  id: string
  vitrineId: string
  slug: string
  titre: string
  description?: string
  type: string
  dureeMin: number
  tarif: string
  prixMontant?: number
  prixDevise?: string
  reservable: boolean
  enVedette: boolean
  ordre: number
  actif: boolean
}

const services = ref<Service[]>([])
const chargement = ref(true)
const erreur = ref('')

async function chargerServices() {
  chargement.value = true
  try {
    const reponse = await $fetch<{ services: Service[] }>('/api/studio/services')
    services.value = reponse.services
  } catch {
    erreur.value = 'Impossible de charger les services.'
  } finally {
    chargement.value = false
  }
}

async function supprimerService(slug: string) {
  if (!confirm('Supprimer ce service ?')) return
  try {
    const reponse = await fetch(`/api/studio/services/${slug}`, { method: 'DELETE' })
    if (!reponse.ok) throw new Error('Suppression refusée')
    await chargerServices()
  } catch {
    erreur.value = 'Impossible de supprimer le service.'
  }
}

function basculerVedette(service: Service) {
  // TODO: appel API PUT pour basculer en_vedette
  console.log('Basculer vedette:', service.slug)
}

function basculerActif(service: Service) {
  // TODO: appel API PUT pour basculer actif
  console.log('Basculer actif:', service.slug)
}

onMounted(() => {
  chargerServices()
})
</script>

<template>
  <div class="studio">
    <BsTopNav actif="services" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <div class="studio__en-tete__groupe">
          <h1>Services</h1>
          <BsButton variant="principal" to="/studio/services/nouveau">Ajouter un service</BsButton>
        </div>
        <p class="studio__sous-titre">
          {{ services.length }} service{{ services.length > 1 ? 's' : '' }}
          · {{ services.filter((s) => s.enVedette).length }} en vedette
        </p>
      </section>

      <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

      <div v-if="services.length > 0" class="services__grille">
        <div v-for="service in services" :key="service.id" class="services__carte">
          <div class="services__carte__en-tete">
            <BsVariant :valeur="service.type" />
            <BsBadge :label="service.tarif" />
          </div>
          <h3 class="services__carte__titre">{{ service.titre }}</h3>
          <p v-if="service.description" class="services__carte__description">
            {{ service.description }}
          </p>
          <div class="services__carte__meta">
            <span class="services__carte__duree">
              {{ service.dureeMin }} min
            </span>
            <span
              v-if="service.prixMontant !== undefined && service.prixDevise"
              class="services__carte__prix"
              >{{ service.prixMontant }} {{ service.prixDevise }}</span
            >
            <span v-else-if="service.tarif === 'gratuit'"
              >Gratuit
            </span>
            <span v-else-if="service.tarif === 'devis'"
              >Sur devis
            </span>
          </div>
          <div class="services__carte__actions">
            <BsButton variant="lien" :to="`/studio/services/${service.slug}`">Modifier</BsButton>
            <BsButton variant="lien" @click="supprimerService(service.slug)"
              >Supprimer</BsButton
            >
          </div>
          <div class="services__carte__interrupteurs">
            <label class="interrupteur-label">
              <BsSwitch v-model="service.enVedette" label="En vedette" @change="basculerVedette(service)" />
            </label>
            <label class="interrupteur-label">
              <BsSwitch v-model="service.actif" label="Visible sur la vitrine" @change="basculerActif(service)" />
            </label>
          </div>
        </div>
      </div>

      <div v-else class="services__vide">
        <p>Aucun service pour le moment.</p>
        <BsButton variant="principal" to="/studio/services/nouveau">Créer un premier service</BsButton>
      </div>
    </main>

    <BsBottomNav actif="services" />
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
.services__grille {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 64rem) {
  .services__grille {
    grid-template-columns: repeat(2, 1fr);
  }
}
.services__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.services__carte__en-tete {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.services__carte__titre {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.services__carte__description {
  font-size: 0.9rem;
  color: var(--texte-secondaire);
  margin: 0;
}
.services__carte__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--texte-secondaire);
  margin-bottom: 0.75rem;
}
.services__carte__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}
.services__carte__interrupteurs {
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
.services__vide {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--texte-secondaire);
}
</style>
